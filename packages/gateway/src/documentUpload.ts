import { appendFile, mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

/** Folder (inside the project's notes/ Documents folder) where phone uploads land. */
export const ASSISTANT_DOCS_DIR = "assistant";

/** What can be attached: text/PDF (read_document), images (read_document shows them) and audio (transcribe_audio). */
export const ALLOWED_DOC_EXTENSIONS = new Set([
  // text the assistant reads
  ".pdf", ".txt", ".md", ".csv", ".tsv", ".json", ".log", ".xml", ".html", ".yaml", ".yml",
  // images it can look at (read_document)
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  // audio it can transcribe (transcribe_audio)
  ".mp3", ".m4a", ".wav", ".ogg", ".opus", ".flac", ".webm", ".aac", ".mp4",
]);

export const MAX_DOC_BYTES = 25 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 1024 * 1024;
const STALE_UPLOAD_MS = 10 * 60 * 1000;

type UploadState = { name: string; nextIndex: number; bytes: number; partPath: string; touched: number };
const uploads = new Map<string, UploadState>();

export type UploadChunk = {
  workspaceRoot: string;
  uploadId: string;
  name: string;
  index: number;
  /** base64 of this chunk's raw bytes */
  data: string;
  final: boolean;
};

export type UploadResult = { received: number; path?: string; bytes?: number };

/** Keeps letters/digits/accents plus `. _ - space ( )`; drops any directory part. */
export function sanitizeDocName(raw: string): string {
  const base = basename(String(raw ?? "").replace(/\\/g, "/")).trim();
  const cleaned = base.replace(/[^\p{L}\p{N}._() -]/gu, "_").replace(/\s+/g, " ").replace(/^\.+/, "");
  const ext = extname(cleaned);
  const stem = cleaned.slice(0, cleaned.length - ext.length).slice(0, 100) || "documento";
  return `${stem}${ext.toLowerCase()}`;
}

async function freeName(dir: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  const taken = new Set(await readdir(dir).catch(() => [] as string[]));
  if (!taken.has(name)) return name;
  for (let n = 1; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

async function dropStale(now: number): Promise<void> {
  for (const [id, state] of uploads) {
    if (now - state.touched > STALE_UPLOAD_MS) {
      uploads.delete(id);
      await rm(state.partPath, { force: true });
    }
  }
}

/**
 * Receives one chunk of a phone upload. Chunks must arrive in order starting
 * at index 0; the last one (`final: true`) moves the file to
 * notes/assistant/<name> and returns its path relative to notes/ — exactly
 * what the assistant's read_document tool expects.
 */
export async function receiveDocumentChunk(chunk: UploadChunk): Promise<UploadResult> {
  const now = Date.now();
  await dropStale(now);

  if (!/^[A-Za-z0-9_-]{6,64}$/.test(chunk.uploadId)) throw new Error("invalid uploadId");
  const name = sanitizeDocName(chunk.name);
  const ext = extname(name);
  if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
    throw new Error(`unsupported file type "${ext || "(none)"}" — allowed: ${[...ALLOWED_DOC_EXTENSIONS].join(", ")}`);
  }

  const bytes = Buffer.from(chunk.data ?? "", "base64");
  if (bytes.byteLength > MAX_CHUNK_BYTES) throw new Error("chunk too large");

  const docsDir = resolve(chunk.workspaceRoot, "notes", ASSISTANT_DOCS_DIR);
  const tmpDir = join(docsDir, ".uploads");
  await mkdir(tmpDir, { recursive: true });
  const partPath = join(tmpDir, `${chunk.uploadId}.part`);

  let state = uploads.get(chunk.uploadId);
  if (chunk.index === 0) {
    if (state) await rm(state.partPath, { force: true });
    state = { name, nextIndex: 0, bytes: 0, partPath, touched: now };
    uploads.set(chunk.uploadId, state);
    await writeFile(partPath, new Uint8Array(0));
  }
  if (!state) throw new Error("unknown upload — start again from chunk 0");
  if (chunk.index !== state.nextIndex) throw new Error(`out-of-order chunk (expected ${state.nextIndex}, got ${chunk.index})`);
  if (state.bytes + bytes.byteLength > MAX_DOC_BYTES) {
    uploads.delete(chunk.uploadId);
    await rm(partPath, { force: true });
    throw new Error(`file too large (max ${MAX_DOC_BYTES / 1024 / 1024} MB)`);
  }

  await appendFile(partPath, bytes);
  state.nextIndex++;
  state.bytes += bytes.byteLength;
  state.touched = now;

  if (!chunk.final) return { received: state.bytes };

  uploads.delete(chunk.uploadId);
  if (state.bytes === 0) {
    await rm(partPath, { force: true });
    throw new Error("empty file");
  }
  const finalName = await freeName(docsDir, state.name);
  await rename(partPath, join(docsDir, finalName));
  const size = (await stat(join(docsDir, finalName))).size;
  return { received: size, path: `${ASSISTANT_DOCS_DIR}/${finalName}`, bytes: size };
}

export type AssistantDoc = { name: string; path: string; bytes: number; modifiedAt: number };

/** Files the phone has uploaded, newest first (dotfiles such as .uploads are skipped). */
export async function listAssistantDocs(workspaceRoot: string): Promise<AssistantDoc[]> {
  const dir = resolve(workspaceRoot, "notes", ASSISTANT_DOCS_DIR);
  const names = await readdir(dir).catch(() => [] as string[]);
  const docs: AssistantDoc[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info?.isFile()) continue;
    docs.push({ name, path: `${ASSISTANT_DOCS_DIR}/${name}`, bytes: info.size, modifiedAt: Math.round(info.mtimeMs) });
  }
  return docs.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** Deletes one uploaded file by name; only direct children of notes/assistant can be removed. */
export async function deleteAssistantDoc(workspaceRoot: string, name: string): Promise<boolean> {
  const clean = basename(String(name ?? "").replace(/\\/g, "/"));
  if (!clean || clean.startsWith(".")) throw new Error("invalid name");
  try {
    await unlink(join(resolve(workspaceRoot, "notes", ASSISTANT_DOCS_DIR), clean));
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
