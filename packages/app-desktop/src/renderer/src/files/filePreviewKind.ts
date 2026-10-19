export type PreviewKind = "text" | "image" | "pdf" | "audio" | "model3d" | "binary";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

// Common binary formats we know we can't render as text or as an image/PDF —
// listed so clicking one shows a clear "can't preview" fallback (with an
// "Open externally" button) instead of dumping raw bytes into the code
// editor as mangled text.
const KNOWN_OTHER_BINARY_EXTS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
  "tar",
  "gz",
  "7z",
  "rar",
  "exe",
  "dmg",
  "app",
  "mp4",
  "mov",
  // 3D formats with no in-app viewer — still previewed as "binary" so the
  // fallback offers Open in Blender instead of mangled text in Monaco.
  "blend",
  "blend1",
  "3ds",
  "abc",
  "usd",
  "usdc",
  "usdz",
  "max",
  "ma",
  "mb",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "sqlite",
  "sqlite3",
  "db",
]);

function extOf(path: string): string {
  return path.slice(path.lastIndexOf(".") + 1).toLowerCase();
}

const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus", "weba"]);

// Formats three.js has a loader for (ModelViewer.tsx).
const MODEL_3D_EXTS = new Set(["glb", "gltf", "fbx", "obj", "stl", "ply", "dae", "3mf"]);

// Anything Blender can open, viewable in-app or not — drives the "Open in Blender" entries.
const BLENDER_EXTS = new Set([...MODEL_3D_EXTS, "blend", "3ds", "abc", "usd", "usda", "usdc", "usdz"]);

export function previewKind(path: string): PreviewKind {
  const ext = extOf(path);
  if (ext === "pdf") return "pdf";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (MODEL_3D_EXTS.has(ext)) return "model3d";
  if (ext in IMAGE_MIME_BY_EXT) return "image";
  if (KNOWN_OTHER_BINARY_EXTS.has(ext)) return "binary";
  return "text";
}

export function isBlenderFile(path: string): boolean {
  return BLENDER_EXTS.has(extOf(path));
}

export function imageMimeType(path: string): string {
  return IMAGE_MIME_BY_EXT[extOf(path)] ?? "application/octet-stream";
}
