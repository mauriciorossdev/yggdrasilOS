import type { Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditorNS, Position } from "monaco-editor";
import { t } from "../i18n/index.js";
import { displaySrc } from "./imageSrc.js";

/** `![alt](address "title")` on a line; group 1 is the alt, 2 the address. */
const IMAGE_SYNTAX = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** The image syntax the 1-based `column` falls in, if any: its alt text, address and 1-based column range. */
export function imageAt(line: string, column: number): { alt: string; src: string; start: number; end: number } | undefined {
  for (const match of line.matchAll(IMAGE_SYNTAX)) {
    const start = match.index! + 1;
    const end = start + match[0].length;
    if (column >= start && column <= end) return { alt: match[1]!, src: match[2]!, start, end };
  }
  return undefined;
}

let registered = false;

/** Largest image the hover will inline; a bigger one would make the card slow to build. */
const MAX_PREVIEW_BYTES = 2_000_000;
// What Monaco's markdown renderer will draw from a data: address.
const PREVIEW_TYPES = /^image\/(png|jpe?g|gif|webp|bmp)$/;

/** The image at `url` as a data: address Monaco can draw (its renderer won't load the app's own file protocol), or null. */
async function previewDataUrl(url: string): Promise<string | null> {
  try {
    const blob = await (await fetch(url)).blob();
    if (blob.size > MAX_PREVIEW_BYTES || !PREVIEW_TYPES.test(blob.type)) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Source view can't draw an image inline, so hovering `![alt](path)` shows it in a small card instead. The
 * note's path comes from the model (CodeEditor passes it as the editor's `path`), to resolve a relative address.
 */
export function ensureImageHover(monaco: Monaco): void {
  if (registered) return;
  registered = true;
  monaco.languages.registerHoverProvider("markdown", {
    async provideHover(model: MonacoEditorNS.ITextModel, position: Position) {
      const hit = imageAt(model.getLineContent(position.lineNumber), position.column);
      if (!hit) return null;
      let notePath = model.uri.path;
      try {
        notePath = decodeURIComponent(notePath);
      } catch {
        // Keep the raw path.
      }
      const url = displaySrc(notePath.replace(/^\/+/, ""), hit.src, (p) => window.yggdrasil.files.fileUrl(p));
      const external = /^https?:/i.test(url);
      const shown = external ? url : await previewDataUrl(url);
      const value = shown ? `![${hit.alt}](${shown})` : t("doc.imageNoPreview", { src: hit.src });
      return {
        range: new monaco.Range(position.lineNumber, hit.start, position.lineNumber, hit.end),
        contents: [{ value, isTrusted: true }],
      };
    },
  });
}
