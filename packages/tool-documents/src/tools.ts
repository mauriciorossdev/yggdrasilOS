import { dirname } from "node:path";
import { lstat, mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { defineTool } from "@yggdrasil/tools-sdk";
import { resolveWithinNotes } from "./scope.js";
import { extractPdfText } from "./pdfText.js";
import { AUDIO_EXTENSIONS } from "./transcribe.js";

const MAX_READ_CHARS = 50_000;

// Formats Claude can look at, and the size cap its API enforces per image.
const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const listDocumentsTool = defineTool({
  name: "list_documents",
  description:
    'Lists files and subfolders inside this project\'s Documents folder (the notes/ directory backing the app\'s Documents tab). Use this — not list_directory — whenever the user asks to see, browse, or review documents/notes, e.g. "revisa los documentos de X". Path is relative to the Documents folder root; omit for the top level.',
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Subfolder path relative to the Documents folder (default: top level)" },
    },
  },
  async execute(ctx, args) {
    const relPath = String(args.path ?? "");
    const target = resolveWithinNotes(ctx, "list_documents", relPath);
    const entries = await readdir(target, { withFileTypes: true });
    const mapped = entries
      .map((e) => ({ name: e.name, type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other" }))
      .sort((a, b) => (a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name)));
    return { path: relPath, entries: mapped };
  },
});

export const readDocumentTool = defineTool({
  name: "read_document",
  description:
    'Reads a document inside this project\'s Documents folder (notes/): text and PDFs come back as text, and IMAGES (jpg, png, webp, gif) are shown to you so you can see them. Audio files are not read here: use transcribe_audio. Use this — not read_file — for anything the user calls a "documento"/"nota"/"Documents" file. Path is relative to the Documents folder root, e.g. "proyecto-x/notas.md".',
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Document path relative to the Documents folder" },
      offset: { type: "number", description: "Character offset to continue reading a long document (use nextOffset from the previous call)" },
    },
    required: ["path"],
  },
  async execute(ctx, args) {
    const relPath = String(args.path ?? "");
    const target = resolveWithinNotes(ctx, "read_document", relPath);
    const ext = relPath.slice(relPath.lastIndexOf(".") + 1).toLowerCase();

    if (AUDIO_EXTENSIONS.has(`.${ext}`)) {
      throw new Error(`"${relPath}" is audio: use transcribe_audio to get its text`);
    }
    const imageMime = IMAGE_MIME[ext];
    if (imageMime) {
      const bytes = await readFile(target);
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(`Image too large (${Math.round(bytes.byteLength / 1024 / 1024)} MB, max 5 MB) — ask the user to attach a smaller one`);
      }
      // The tool loop recognizes this marker and hands the pixels to the model.
      return { __ygg_image__: true, base64: bytes.toString("base64"), mimeType: imageMime, path: relPath };
    }

    let content: string;
    if (ext === "pdf") {
      const bytes = await readFile(target);
      content = await extractPdfText(bytes);
    } else {
      content = await readFile(target, "utf8");
    }

    // `offset` lets a caller page through a long document (a PDF can be far
    // larger than one read): pass the previous result's nextOffset.
    const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0);
    if (offset > 0 || content.length > MAX_READ_CHARS) {
      const end = offset + MAX_READ_CHARS;
      const truncated = end < content.length;
      return {
        path: relPath,
        content: content.slice(offset, end),
        truncated,
        totalLength: content.length,
        ...(offset > 0 ? { offset } : {}),
        ...(truncated ? { nextOffset: end } : {}),
      };
    }
    return { path: relPath, content, truncated: false };
  },
});

export const writeDocumentTool = defineTool({
  name: "write_document",
  description:
    'Creates or overwrites a document inside this project\'s Documents folder (notes/), creating any missing subfolders. Use this — not write_file — when the user asks to create/save/write a document/note, e.g. "crea un documento sobre esto en X carpeta de documents". Requires user approval.',
  riskLevel: "destructive",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Document path relative to the Documents folder, e.g. "proyecto-x/resumen.md"' },
      content: { type: "string", description: "Text content to write" },
    },
    required: ["path", "content"],
  },
  async execute(ctx, args) {
    const relPath = String(args.path ?? "");
    const content = String(args.content ?? "");
    const target = resolveWithinNotes(ctx, "write_document", relPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    return { path: relPath, bytesWritten: Buffer.byteLength(content, "utf8") };
  },
});

export const deleteDocumentTool = defineTool({
  name: "delete_document",
  description: "Deletes a document or empty subfolder inside this project's Documents folder (notes/). Requires user approval.",
  riskLevel: "destructive",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Document (or empty folder) path relative to the Documents folder" },
    },
    required: ["path"],
  },
  async execute(ctx, args) {
    const relPath = String(args.path ?? "");
    const target = resolveWithinNotes(ctx, "delete_document", relPath);
    const stat = await lstat(target);
    if (stat.isDirectory()) {
      await rmdir(target);
    } else {
      await unlink(target);
    }
    return { path: relPath, deleted: true };
  },
});

export const renameDocumentTool = defineTool({
  name: "rename_document",
  description: "Renames or moves a document within this project's Documents folder (notes/). Creates destination subfolders as needed. Requires user approval.",
  riskLevel: "destructive",
  parameters: {
    type: "object",
    properties: {
      fromPath: { type: "string", description: "Current path relative to the Documents folder" },
      toPath: { type: "string", description: "New path relative to the Documents folder" },
    },
    required: ["fromPath", "toPath"],
  },
  async execute(ctx, args) {
    const fromPath = String(args.fromPath ?? "");
    const toPath = String(args.toPath ?? "");
    const from = resolveWithinNotes(ctx, "rename_document", fromPath);
    const to = resolveWithinNotes(ctx, "rename_document", toPath);
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    return { fromPath, toPath };
  },
});
