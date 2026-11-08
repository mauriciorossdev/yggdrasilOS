import { t } from "../i18n/index.js";

/** Lets an editor ask for another file to be opened, wherever that editor is showing. */
type Opener = {
  /** Whether this surface shows the editor asking. */
  contains: (element: Element) => boolean;
  open: (relativePath: string) => void;
};

const openers = new Set<Opener>();
let fallback: ((relativePath: string) => void) | null = null;
/** The side panel holds one file: opening another replaces it, so its unsaved edits would be lost. */
let fallbackDirty = false;

export function setFallbackOpenerDirty(dirty: boolean): void {
  fallbackDirty = dirty;
}

export function registerFileOpener(opener: Opener): () => void {
  openers.add(opener);
  return () => openers.delete(opener);
}

export function registerFallbackFileOpener(open: (relativePath: string) => void): () => void {
  fallback = open;
  return () => {
    if (fallback === open) fallback = null;
  };
}

export function requestOpenFile(from: Element, relativePath: string): boolean {
  for (const opener of openers) {
    if (opener.contains(from)) {
      opener.open(relativePath);
      return true;
    }
  }
  if (!fallback) return false;
  if (!fallbackDirty || window.confirm(t("doc.discardConfirm"))) fallback(relativePath);
  return true;
}
