export type DiffLayout = "unified" | "split";

const DIFF_LAYOUT_KEY = "ygg.repo.diffLayout";

/** Unified or split, shared by Repositorio's diff and the side panel's. */
export function readDiffLayout(): DiffLayout {
  try {
    return localStorage.getItem(DIFF_LAYOUT_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

export function writeDiffLayout(next: DiffLayout): void {
  try {
    localStorage.setItem(DIFF_LAYOUT_KEY, next);
  } catch {
    // storage unavailable — choice just won't persist
  }
}
