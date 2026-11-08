import type { FsEntry } from "../types.js";

export type FileKind = "md" | "code" | "json" | "config" | "style" | "other";

const KIND_BY_EXT: Record<string, FileKind> = {
  md: "md",
  mdx: "md",
  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  mjs: "code",
  cjs: "code",
  json: "json",
  jsonc: "json",
  yml: "config",
  yaml: "config",
  toml: "config",
  css: "style",
  scss: "style",
};

/** What color/icon a file gets in the tree, from its extension only. */
export function fileKind(name: string): FileKind {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "other";
  return KIND_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? "other";
}

/** Config-ish entries (`.git`, `.claude`, `_backup`): shown dimmed and after the rest. */
export function isHiddenName(name: string): boolean {
  return name.startsWith(".") || name.startsWith("_");
}

/**
 * Folders first, then files, then the hidden ones (folders before files);
 * each group keeps the order the gateway gave. Stable, so a refresh never
 * reshuffles rows that didn't change.
 */
export function sortEntries(entries: FsEntry[]): FsEntry[] {
  const group = (e: FsEntry): number => {
    const hidden = isHiddenName(e.name);
    const dir = e.type === "directory";
    return hidden ? (dir ? 2 : 3) : dir ? 0 : 1;
  };
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => group(a.entry) - group(b.entry) || a.index - b.index)
    .map((x) => x.entry);
}
