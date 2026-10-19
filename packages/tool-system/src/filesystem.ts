import { readdir, readFile, writeFile } from "node:fs/promises";
import { defineTool } from "@yggdrasil/tools-sdk";

const MAX_READ_BYTES = 50_000;
const MAX_DIR_ENTRIES = 100;

export const listDirectoryTool = defineTool({
  name: "list_directory",
  description: "Lists files and subdirectories at a given path (relative to cwd or absolute). Truncates large directories.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path (default: current directory)" },
    },
  },
  async execute(_ctx, args) {
    const path = String(args.path ?? ".");
    const entries = await readdir(path, { withFileTypes: true });
    const mapped = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other",
    }));
    if (mapped.length > MAX_DIR_ENTRIES) {
      return {
        path,
        entries: mapped.slice(0, MAX_DIR_ENTRIES),
        truncated: true,
        totalEntries: mapped.length,
      };
    }
    return { path, entries: mapped, truncated: false };
  },
});

export const readFileTool = defineTool({
  name: "read_file",
  description: "Reads a text file's contents (relative to cwd or absolute path). Truncates large files.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to read" },
    },
    required: ["path"],
  },
  async execute(_ctx, args) {
    const path = String(args.path ?? "");
    const content = await readFile(path, "utf8");
    if (content.length > MAX_READ_BYTES) {
      return {
        path,
        content: content.slice(0, MAX_READ_BYTES),
        truncated: true,
        totalLength: content.length,
      };
    }
    return { path, content, truncated: false };
  },
});

export const writeFileTool = defineTool({
  name: "write_file",
  description: "Writes (overwrites) a text file with given content. Creates the file if it doesn't exist. Requires user approval.",
  riskLevel: "destructive",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write" },
      content: { type: "string", description: "Text content to write" },
    },
    required: ["path", "content"],
  },
  async execute(_ctx, args) {
    const path = String(args.path ?? "");
    const content = String(args.content ?? "");
    await writeFile(path, content, "utf8");
    return { path, bytesWritten: Buffer.byteLength(content, "utf8") };
  },
});
