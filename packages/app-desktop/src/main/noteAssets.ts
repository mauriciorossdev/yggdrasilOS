/** Image types a note can hold, by extension. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"] as const;

/** Largest image the editor will store (pasted screenshots are far below this). */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

export function extensionForMime(mime: string): string | undefined {
  return EXTENSION_BY_MIME[mime.toLowerCase()];
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

export function isImageName(fileName: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

/**
 * A file name safe to link from markdown and to write on any OS: no spaces or path separators (an address
 * with a space doesn't parse as an image), only letters, digits, dots, dashes and underscores, short, and
 * with a lowercase extension.
 */
export function sanitizeAssetName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const ext = extensionOf(base);
  const stem = (ext ? base.slice(0, -(ext.length + 1)) : base)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 60);
  return `${stem || "imagen"}${ext ? `.${ext}` : ""}`;
}

/** Name for an image that arrives without one (a pasted screenshot): `imagen-20261104-153045.png`. */
export function generatedAssetName(date: Date, extension: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `imagen-${day}-${time}.${extension}`;
}

/** `a.png` taken? then `a-2.png`, `a-3.png`... Comparison ignores case, as macOS and Windows do. */
export function uniqueAssetName(name: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((n) => n.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const ext = extensionOf(name);
  const stem = ext ? name.slice(0, -(ext.length + 1)) : name;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext ? `.${ext}` : ""}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
