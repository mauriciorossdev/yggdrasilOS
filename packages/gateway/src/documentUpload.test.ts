import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_CHUNK_BYTES, deleteAssistantDoc, listAssistantDocs, receiveDocumentChunk, sanitizeDocName } from "./documentUpload.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "docupload-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const b64 = (s: string | Uint8Array) => Buffer.from(s).toString("base64");

describe("sanitizeDocName", () => {
  it("drops directories and unsafe characters, keeps accents", () => {
    expect(sanitizeDocName("../../etc/pass wd.TXT")).toBe("pass wd.txt");
    expect(sanitizeDocName("C:\\x\\Informe año 2026.pdf")).toBe("Informe año 2026.pdf");
    expect(sanitizeDocName("a<b>:c?.md")).toBe("a_b__c_.md");
  });
});

describe("receiveDocumentChunk", () => {
  it("assembles chunks into notes/assistant and returns the notes-relative path", async () => {
    const id = "upload-0001";
    const first = await receiveDocumentChunk({ workspaceRoot: root, uploadId: id, name: "nota.md", index: 0, data: b64("hola "), final: false });
    expect(first.path).toBeUndefined();
    const done = await receiveDocumentChunk({ workspaceRoot: root, uploadId: id, name: "nota.md", index: 1, data: b64("mundo"), final: true });
    expect(done.path).toBe("assistant/nota.md");
    expect(done.bytes).toBe(10);
    expect(await readFile(join(root, "notes/assistant/nota.md"), "utf8")).toBe("hola mundo");
    expect(await readdir(join(root, "notes/assistant/.uploads"))).toEqual([]);
  });

  it("does not overwrite: a second file with the same name gets a numbered name", async () => {
    for (const id of ["upload-0002", "upload-0003"]) {
      await receiveDocumentChunk({ workspaceRoot: root, uploadId: id, name: "x.txt", index: 0, data: b64("a"), final: true });
    }
    expect((await readdir(join(root, "notes/assistant"))).filter((f) => f.endsWith(".txt")).sort()).toEqual(["x (1).txt", "x.txt"]);
  });

  it("rejects unsupported types, bad ids, out-of-order chunks and oversized chunks", async () => {
    const base = { workspaceRoot: root, index: 0, data: b64("a"), final: true };
    await expect(receiveDocumentChunk({ ...base, uploadId: "upload-0004", name: "virus.exe" })).rejects.toThrow(/unsupported/);
    await expect(receiveDocumentChunk({ ...base, uploadId: "../bad", name: "a.txt" })).rejects.toThrow(/invalid uploadId/);
    await receiveDocumentChunk({ ...base, uploadId: "upload-0005", name: "a.txt", final: false });
    await expect(receiveDocumentChunk({ ...base, uploadId: "upload-0005", name: "a.txt", index: 5 })).rejects.toThrow(/out-of-order/);
    await expect(
      receiveDocumentChunk({ ...base, uploadId: "upload-0006", name: "b.txt", data: b64(new Uint8Array(MAX_CHUNK_BYTES + 1)) }),
    ).rejects.toThrow(/too large/);
  });

  it("rejects an empty file and a chunk for an unknown upload", async () => {
    await expect(
      receiveDocumentChunk({ workspaceRoot: root, uploadId: "upload-0007", name: "e.txt", index: 0, data: "", final: true }),
    ).rejects.toThrow(/empty/);
    await expect(
      receiveDocumentChunk({ workspaceRoot: root, uploadId: "upload-0008", name: "e.txt", index: 1, data: b64("a"), final: true }),
    ).rejects.toThrow(/unknown upload/);
  });
});

describe("listAssistantDocs / deleteAssistantDoc", () => {
  it("lists uploaded files (not the .uploads folder) and deletes only direct children", async () => {
    await receiveDocumentChunk({ workspaceRoot: root, uploadId: "upload-0010", name: "uno.txt", index: 0, data: b64("a"), final: true });
    await receiveDocumentChunk({ workspaceRoot: root, uploadId: "upload-0011", name: "dos.md", index: 0, data: b64("bb"), final: true });

    const docs = await listAssistantDocs(root);
    expect(docs.map((d) => d.path).sort()).toEqual(["assistant/dos.md", "assistant/uno.txt"]);
    expect(docs.find((d) => d.name === "dos.md")?.bytes).toBe(2);

    expect(await deleteAssistantDoc(root, "uno.txt")).toBe(true);
    expect(await deleteAssistantDoc(root, "uno.txt")).toBe(false);
    expect(await deleteAssistantDoc(root, "../../uno.txt")).toBe(false);
    await expect(deleteAssistantDoc(root, ".uploads")).rejects.toThrow(/invalid/);
    expect((await listAssistantDocs(root)).map((d) => d.name)).toEqual(["dos.md"]);
  });

  it("returns an empty list when nothing was uploaded yet", async () => {
    expect(await listAssistantDocs(root)).toEqual([]);
  });
});
