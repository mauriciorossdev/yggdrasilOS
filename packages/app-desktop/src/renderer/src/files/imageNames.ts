// Mirrors main/noteAssets.ts's image types (main and renderer keep separate copies rather than importing across
// the Electron process boundary).
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
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

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(extensionOf(name));
}

/** A file from the clipboard or a drop that is an image, by its type or, failing that, its name. */
export function isImageFile(file: { name: string; type: string }): boolean {
  return file.type.startsWith("image/") || isImageName(file.name);
}

/**
 * The name to store a file under. Browsers call a pasted screenshot just "image.png", which says nothing and
 * would collide, so those (and unnamed files) get a date-based name; real names are kept.
 */
export function imageFileName(file: { name: string; type: string }, now: Date): string {
  const ext = extensionOf(file.name) || EXTENSION_BY_MIME[file.type.toLowerCase()] || "png";
  const generic = !file.name || /^image\.[a-z0-9]+$/i.test(file.name);
  if (!generic && isImageName(file.name)) return file.name;
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `imagen-${day}-${time}.${ext}`;
}

/** A readable alt text from a file name: `diagrama-de_panes.png` → `diagrama de panes`. */
export function altFromFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const ext = extensionOf(base);
  const stem = ext ? base.slice(0, -(ext.length + 1)) : base;
  return stem.replace(/[-_]+/g, " ").trim();
}

/**
 * The address to write in a note at `notePath` for the project file `targetPath`, relative to the note's folder
 * (`notes/a/n.md` → `notes/a/assets/x.png` is `assets/x.png`; `notes/b/x.png` is `../b/x.png`).
 */
export function relativeFromNote(notePath: string, targetPath: string): string {
  const from = notePath.split("/").slice(0, -1);
  const to = targetPath.split("/");
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared++;
  const up = from.slice(shared).map(() => "..");
  return [...up, ...to.slice(shared)].join("/");
}
