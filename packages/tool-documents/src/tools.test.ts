import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yggdrasil/tools-sdk";
import {
  listDocumentsTool,
  readDocumentTool,
  writeDocumentTool,
  deleteDocumentTool,
  renameDocumentTool,
} from "./tools.js";

// Deliberately no proper xref table — pdfjs-dist falls back to scanning the
// file for objects when the xref is missing/broken, same fallback real-world
// "slightly off" PDFs exercise. Verified this extracts "Hello PDF".
const MINIMAL_PDF_WITH_TEXT = Buffer.from(
  [
    "%PDF-1.1",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 200 100] /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "5 0 obj << /Length 44 >>",
    "stream",
    "BT /F1 24 Tf 10 50 Td (Hello PDF) Tj ET",
    "endstream",
    "endobj",
    "trailer << /Size 6 /Root 1 0 R >>",
    "%%EOF",
    "",
  ].join("\n"),
  "utf8",
);

describe("documents tools", () => {
  let projectRoot: string;
  let notesDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "documents-tool-"));
    notesDir = join(projectRoot, "notes");
    mkdirSync(notesDir);
    ctx = { sessionKey: "test", config: {}, workspaceRoot: projectRoot };
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  describe("list_documents", () => {
    it("lists files and subfolders under notes/", async () => {
      writeFileSync(join(notesDir, "a.md"), "hi");
      mkdirSync(join(notesDir, "sub"));

      const result = (await listDocumentsTool.execute(ctx, {})) as {
        entries: Array<{ name: string; type: string }>;
      };
      const byName = Object.fromEntries(result.entries.map((e) => [e.name, e.type]));
      expect(byName["a.md"]).toBe("file");
      expect(byName["sub"]).toBe("directory");
    });

    it("lists a subfolder via path", async () => {
      mkdirSync(join(notesDir, "sub"));
      writeFileSync(join(notesDir, "sub", "b.md"), "hi");

      const result = (await listDocumentsTool.execute(ctx, { path: "sub" })) as {
        entries: Array<{ name: string; type: string }>;
      };
      expect(result.entries).toEqual([{ name: "b.md", type: "file" }]);
    });
  });

  describe("read_document", () => {
    it("reads a plain text document", async () => {
      writeFileSync(join(notesDir, "notes.md"), "# Heading\n\nBody.");

      const result = (await readDocumentTool.execute(ctx, { path: "notes.md" })) as {
        content: string;
        truncated: boolean;
      };
      expect(result.content).toBe("# Heading\n\nBody.");
      expect(result.truncated).toBe(false);
    });

    it("pages through a long document with offset/nextOffset", async () => {
      writeFileSync(join(notesDir, "long.txt"), "a".repeat(50_000) + "b".repeat(10));

      const first = (await readDocumentTool.execute(ctx, { path: "long.txt" })) as {
        content: string;
        truncated: boolean;
        nextOffset?: number;
        totalLength: number;
      };
      expect(first.truncated).toBe(true);
      expect(first.content).toHaveLength(50_000);
      expect(first.nextOffset).toBe(50_000);
      expect(first.totalLength).toBe(50_010);

      const second = (await readDocumentTool.execute(ctx, { path: "long.txt", offset: first.nextOffset })) as {
        content: string;
        truncated: boolean;
        nextOffset?: number;
      };
      expect(second.content).toBe("b".repeat(10));
      expect(second.truncated).toBe(false);
      expect(second.nextOffset).toBeUndefined();
    });

    it("returns images as a marker the tool loop turns into pixels, with the right mime type", async () => {
      writeFileSync(join(notesDir, "foto.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
      const result = (await readDocumentTool.execute(ctx, { path: "foto.jpg" })) as Record<string, unknown>;
      expect(result.__ygg_image__).toBe(true);
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.path).toBe("foto.jpg");
      expect(Buffer.from(String(result.base64), "base64")[0]).toBe(0xff);
    });

    it("refuses images over Claude's 5 MB limit and points audio to transcribe_audio", async () => {
      writeFileSync(join(notesDir, "gigante.png"), Buffer.alloc(5 * 1024 * 1024 + 1));
      await expect(readDocumentTool.execute(ctx, { path: "gigante.png" })).rejects.toThrow(/too large/);
      writeFileSync(join(notesDir, "nota.m4a"), Buffer.from([1, 2, 3]));
      await expect(readDocumentTool.execute(ctx, { path: "nota.m4a" })).rejects.toThrow(/transcribe_audio/);
    });

    it("extracts text from a PDF", async () => {
      writeFileSync(join(notesDir, "doc.pdf"), MINIMAL_PDF_WITH_TEXT);

      const result = (await readDocumentTool.execute(ctx, { path: "doc.pdf" })) as { content: string };
      expect(result.content).toContain("Hello PDF");
    });
  });

  describe("write_document", () => {
    it("creates a document that can be read back", async () => {
      const result = (await writeDocumentTool.execute(ctx, {
        path: "new.md",
        content: "written content",
      })) as { path: string; bytesWritten: number };

      expect(result.path).toBe("new.md");
      expect(readFileSync(join(notesDir, "new.md"), "utf8")).toBe("written content");
    });

    it("creates a not-yet-existing subfolder before writing", async () => {
      await writeDocumentTool.execute(ctx, { path: "proyecto-x/resumen.md", content: "hola" });
      expect(readFileSync(join(notesDir, "proyecto-x", "resumen.md"), "utf8")).toBe("hola");
    });

    it("overwrites an existing document", async () => {
      writeFileSync(join(notesDir, "overwrite.md"), "old");
      await writeDocumentTool.execute(ctx, { path: "overwrite.md", content: "new" });
      expect(readFileSync(join(notesDir, "overwrite.md"), "utf8")).toBe("new");
    });
  });

  describe("delete_document", () => {
    it("deletes a document", async () => {
      writeFileSync(join(notesDir, "gone.md"), "bye");
      await deleteDocumentTool.execute(ctx, { path: "gone.md" });
      expect(existsSync(join(notesDir, "gone.md"))).toBe(false);
    });
  });

  describe("rename_document", () => {
    it("renames a document, creating destination subfolders as needed", async () => {
      writeFileSync(join(notesDir, "old.md"), "content");
      await renameDocumentTool.execute(ctx, { fromPath: "old.md", toPath: "archive/new.md" });
      expect(existsSync(join(notesDir, "old.md"))).toBe(false);
      expect(readFileSync(join(notesDir, "archive", "new.md"), "utf8")).toBe("content");
    });
  });

  describe("path escaping", () => {
    it("rejects a relative ../ escape", async () => {
      await expect(readDocumentTool.execute(ctx, { path: "../../etc/passwd" })).rejects.toThrow(
        /escapes the notes/,
      );
    });

    it("rejects an absolute path", async () => {
      await expect(readDocumentTool.execute(ctx, { path: "/etc/passwd" })).rejects.toThrow(/escapes the notes/);
    });

    it("rejects when workspaceRoot is missing", async () => {
      const bareCtx: ToolContext = { sessionKey: "test", config: {} };
      await expect(readDocumentTool.execute(bareCtx, { path: "a.md" })).rejects.toThrow(/no workspaceRoot/);
    });
  });
});
