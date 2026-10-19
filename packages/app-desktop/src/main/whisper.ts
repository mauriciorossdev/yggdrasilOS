import { join } from "node:path";
import { access, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Known-stable model source: the same ggml-*.bin files whisper.cpp's own
 * README points people at. Desktop can comfortably run small/medium;
 * tiny/base are the fast/low-RAM options. ".en" variants are English-only
 * and smaller/faster; the plain names are multilingual (needed when
 * `language` isn't "en").
 */
export const WHISPER_MODELS = [
  "tiny.en",
  "tiny",
  "base.en",
  "base",
  "small.en",
  "small",
  "medium.en",
  "medium",
] as const;
export type WhisperModelName = (typeof WHISPER_MODELS)[number];

function modelUrl(name: string): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;
}

function modelFilePath(modelsDir: string, name: string): string {
  return join(modelsDir, `ggml-${name}.bin`);
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function listDownloadedModels(modelsDir: string): Promise<string[]> {
  if (!(await fileExists(modelsDir))) return [];
  const entries = await readdir(modelsDir);
  return entries
    .filter((f) => f.startsWith("ggml-") && f.endsWith(".bin"))
    .map((f) => f.slice("ggml-".length, -".bin".length));
}

export async function isModelDownloaded(modelsDir: string, name: string): Promise<boolean> {
  return fileExists(modelFilePath(modelsDir, name));
}

/**
 * Streams a ggml model into modelsDir, reporting 0..1 progress. Downloads to
 * a `.part` file first and renames on success, so a crashed/cancelled
 * download never leaves a file that `isModelDownloaded` mistakes for a
 * complete one.
 */
export async function downloadModel(
  modelsDir: string,
  name: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  await mkdir(modelsDir, { recursive: true });
  const dest = modelFilePath(modelsDir, name);
  const partial = `${dest}.part`;

  const response = await fetch(modelUrl(name));
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download model "${name}": HTTP ${response.status}`);
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
  if (total > 0 && onProgress) {
    source.on("data", (chunk: Buffer) => {
      received += chunk.length;
      onProgress(received / total);
    });
  }

  await pipeline(source, createWriteStream(partial));
  await rename(partial, dest);
}

export async function deleteModel(modelsDir: string, name: string): Promise<void> {
  const dest = modelFilePath(modelsDir, name);
  if (await fileExists(dest)) await unlink(dest);
}

/**
 * Locates a bundled whisper.cpp server binary if present — otherwise the
 * user must set a binary path in Settings. Must be a `whisper-server`
 * build specifically (not `whisper-cli`): transcription runs against a
 * persistent whisper-server process (see whisperServer.ts) so the model is
 * loaded into RAM once, not reloaded on every dictation.
 *
 * CPU and GPU builds are different binaries that can't be mixed in one
 * folder — resources/whisper/{platform}[-gpu]/ are kept separate. No
 * resources are actually bundled for app-desktop yet (unlike a packaged
 * build with its own installer step), so this currently always returns
 * null and the user browses to their own build — same fallback app-avatar
 * has when no bundled binary matches.
 */
export async function findBundledBinary(
  resourcesDir: string,
  backend: "cpu" | "gpu" = "cpu",
): Promise<string | null> {
  const platformFolder = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
  const folder = backend === "gpu" ? `${platformFolder}-gpu` : platformFolder;
  const binaryName = process.platform === "win32" ? "whisper-server.exe" : "whisper-server";
  const path = join(resourcesDir, "whisper", folder, binaryName);
  return (await fileExists(path)) ? path : null;
}
