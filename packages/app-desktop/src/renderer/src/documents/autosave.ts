import type { MessageKey } from "../i18n/index.js";

/** The part of a Documents tab the autosave rules look at. */
export type AutosaveTab = {
  content: string;
  savedContent: string;
  loading: boolean;
  error: string | null;
  truncated: boolean;
  diskConflict?: string;
  saveState?: "saving" | "saved" | "error";
};

/** Waits this long after the last keystroke before writing the note. */
export const AUTOSAVE_DELAY_MS = 1500;

/**
 * Whether a tab should be written to disk on its own. Never while the file is only
 * partly loaded (writing it back would drop the rest), still loading, in conflict with
 * a change on disk (the user has to pick a side first), or already being written.
 */
export function shouldAutosave(tab: AutosaveTab | undefined): boolean {
  if (!tab) return false;
  if (tab.loading || tab.error || tab.truncated) return false;
  if (tab.diskConflict !== undefined) return false;
  if (tab.saveState === "saving") return false;
  return tab.content !== tab.savedContent;
}

export type SaveMessage = { key: MessageKey; vars?: Record<string, string | number> };
export type SaveStatus = { tone: "saved" | "saving" | "dirty" | "error" | "blocked"; message: SaveMessage | null };

/** What the status bar says about a tab. */
export function saveStatus(tab: (AutosaveTab & { saveError?: string }) | undefined): SaveStatus {
  if (!tab) return { tone: "saved", message: null };
  if (tab.truncated) return { tone: "blocked", message: { key: "docs.save.readOnly" } };
  if (tab.diskConflict !== undefined) return { tone: "blocked", message: { key: "docs.save.conflict" } };
  if (tab.saveState === "error" && tab.content !== tab.savedContent) {
    return {
      tone: "error",
      message: tab.saveError ? { key: "docs.save.failedWith", vars: { reason: tab.saveError } } : { key: "docs.save.failed" },
    };
  }
  if (tab.saveState === "saving") return { tone: "saving", message: { key: "docs.save.saving" } };
  if (tab.content !== tab.savedContent) return { tone: "dirty", message: { key: "docs.save.dirty" } };
  return { tone: "saved", message: { key: "docs.save.saved" } };
}
