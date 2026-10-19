import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yggdrasil/tools-sdk";
import { listDirectoryTool, readFileTool, writeFileTool } from "./filesystem.js";

const ctx: ToolContext = { sessionKey: "test", config: {} };

describe("filesystem tools", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fs-tool-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("list_directory", () => {
    it("lists files and subdirectories with correct types", async () => {
      writeFileSync(join(dir, "a.txt"), "hi");
      mkdirSync(join(dir, "subdir"));

      const result = (await listDirectoryTool.execute(ctx, { path: dir })) as {
        path: string;
        entries: Array<{ name: string; type: string }>;
      };

      expect(result.path).toBe(dir);
      const byName = Object.fromEntries(result.entries.map((e) => [e.name, e.type]));
      expect(byName["a.txt"]).toBe("file");
      expect(byName["subdir"]).toBe("directory");
    });

    it("defaults to '.' when no path is given", async () => {
      const result = (await listDirectoryTool.execute(ctx, {})) as { path: string };
      expect(result.path).toBe(".");
    });

    it("rejects for a directory that does not exist", async () => {
      await expect(
        listDirectoryTool.execute(ctx, { path: join(dir, "nope") }),
      ).rejects.toThrow();
    });
  });

  describe("read_file", () => {
    it("reads a small file fully", async () => {
      const file = join(dir, "small.txt");
      writeFileSync(file, "hello world");

      const result = (await readFileTool.execute(ctx, { path: file })) as {
        content: string;
        truncated: boolean;
      };

      expect(result.content).toBe("hello world");
      expect(result.truncated).toBe(false);
    });

    it("truncates files larger than MAX_READ_BYTES", async () => {
      const file = join(dir, "big.txt");
      const big = "x".repeat(60_000);
      writeFileSync(file, big);

      const result = (await readFileTool.execute(ctx, { path: file })) as {
        content: string;
        truncated: boolean;
        totalLength: number;
      };

      expect(result.truncated).toBe(true);
      expect(result.content.length).toBe(50_000);
      expect(result.totalLength).toBe(60_000);
    });

    it("rejects for a file that does not exist", async () => {
      await expect(
        readFileTool.execute(ctx, { path: join(dir, "missing.txt") }),
      ).rejects.toThrow();
    });
  });

  describe("write_file", () => {
    it("writes content that can be read back", async () => {
      const file = join(dir, "out.txt");

      const result = (await writeFileTool.execute(ctx, {
        path: file,
        content: "written content",
      })) as { path: string; bytesWritten: number };

      expect(result.path).toBe(file);
      expect(result.bytesWritten).toBe(Buffer.byteLength("written content", "utf8"));
      expect(readFileSync(file, "utf8")).toBe("written content");
    });

    it("overwrites an existing file", async () => {
      const file = join(dir, "overwrite.txt");
      writeFileSync(file, "old");

      await writeFileTool.execute(ctx, { path: file, content: "new" });

      expect(readFileSync(file, "utf8")).toBe("new");
    });
  });
});
