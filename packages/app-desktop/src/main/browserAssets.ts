import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, normalize, relative, resolve, sep } from "node:path";

/**
 * Saving a file a page references (an image, a PDF…) into the project on behalf
 * of an agent (browser_save_asset). Everything here assumes the agent may have
 * been steered by hostile page content, so the destination, the file kind and
 * the size are all constrained, and an existing file is never overwritten.
 */

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico", ".svg", ".pdf", ".txt", ".md", ".csv", ".json",
]);

const FORBIDDEN_DIRS = new Set([".git", "node_modules"]);

export class AssetError extends Error {}

export function isAllowedContentType(contentType: string): boolean {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  return (
    type.startsWith("image/") ||
    type === "application/pdf" ||
    type === "application/json" ||
    type === "text/plain" ||
    type === "text/markdown" ||
    type === "text/csv"
  );
}

/** Extension implied by a content type, for when the agent's path has none. */
export function extensionFor(contentType: string): string | undefined {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  const map: Record<string, string> = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/avif": ".avif",
    "image/bmp": ".bmp", "image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico", "image/svg+xml": ".svg",
    "application/pdf": ".pdf", "application/json": ".json", "text/plain": ".txt", "text/markdown": ".md", "text/csv": ".csv",
  };
  return map[type];
}

/**
 * Validates `relPath` (project-relative) and returns the absolute destination.
 * Lexical checks first (no absolute paths, no `..`, no .git/node_modules, only
 * allowed extensions), then a realpath check on the deepest existing ancestor so
 * a symlink inside the project can't redirect the write elsewhere.
 */
export async function resolveAssetDest(projectPath: string, relPath: string, fallbackExt?: string): Promise<string> {
  if (typeof relPath !== "string" || relPath.trim() === "" || relPath.includes("\0")) throw new AssetError("path is required");
  if (isAbsolute(relPath)) throw new AssetError("path must be relative to the project folder");
  const cleaned = normalize(relPath);
  const segments = cleaned.split(sep);
  if (segments.includes("..")) throw new AssetError("path must stay inside the project folder");
  if (segments.some((s) => FORBIDDEN_DIRS.has(s))) throw new AssetError("path may not point into .git or node_modules");

  let rel = cleaned;
  if (extname(basename(rel)) === "") {
    if (!fallbackExt) throw new AssetError("path needs a file extension");
    rel += fallbackExt;
  }
  if (!ALLOWED_EXTENSIONS.has(extname(rel).toLowerCase())) {
    throw new AssetError(`extension ${extname(rel)} is not allowed (images, pdf, txt, md, csv, json)`);
  }

  const root = await realpath(projectPath);
  const dest = resolve(root, rel);
  if (relative(root, dest).startsWith("..")) throw new AssetError("path must stay inside the project folder");

  // The deepest ancestor that already exists must itself resolve inside the project.
  let probe = dirname(dest);
  for (;;) {
    try {
      const real = await realpath(probe);
      if (relative(root, real).startsWith("..") || isAbsolute(relative(root, real))) {
        throw new AssetError("path must stay inside the project folder");
      }
      break;
    } catch (err) {
      if (err instanceof AssetError) throw err;
      const parent = dirname(probe);
      if (parent === probe) throw new AssetError("path must stay inside the project folder");
      probe = parent;
    }
  }
  return dest;
}

export type FetchedAsset = { data: Uint8Array; contentType: string; url: string };

/** Reads a fetch Response body up to `max` bytes, rejecting early on a declared or streamed overrun. */
export async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new AssetError(`file is larger than ${Math.floor(max / 1024 / 1024)} MB`);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new AssetError(`file is larger than ${Math.floor(max / 1024 / 1024)} MB`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Decodes a `data:` URL (only the kinds a saved asset may be). */
export function decodeDataUrl(url: string, max: number): FetchedAsset {
  const m = /^data:([^,;]*)(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new AssetError("malformed data: URL");
  const contentType = m[1] || "text/plain";
  const data = m[2] ? Buffer.from(m[3]!, "base64") : Buffer.from(decodeURIComponent(m[3]!), "utf8");
  if (data.byteLength > max) throw new AssetError(`file is larger than ${Math.floor(max / 1024 / 1024)} MB`);
  return { data: new Uint8Array(data), contentType, url: "data:" };
}

export type SaveAssetResult = { path: string; bytes: number; contentType: string; sourceUrl: string };

/** Validates and writes an already-fetched asset. Never overwrites an existing file. */
export async function saveFetchedAsset(projectPath: string, relPath: string, asset: FetchedAsset): Promise<SaveAssetResult> {
  if (!isAllowedContentType(asset.contentType)) {
    throw new AssetError(`content type ${asset.contentType || "(none)"} is not allowed (images, pdf, text, json)`);
  }
  if (asset.data.byteLength > MAX_ASSET_BYTES) throw new AssetError("file is too large");
  const dest = await resolveAssetDest(projectPath, relPath, extensionFor(asset.contentType));
  try {
    await stat(dest);
    throw new AssetError(`${relative(await realpath(projectPath), dest)} already exists — pick another path`);
  } catch (err) {
    if (err instanceof AssetError) throw err;
  }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, asset.data, { flag: "wx" });
  return {
    path: relative(await realpath(projectPath), dest),
    bytes: asset.data.byteLength,
    contentType: asset.contentType.split(";")[0]!.trim(),
    sourceUrl: asset.url,
  };
}

