/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Only this file needs DOM types — tsconfig.node.json's `lib` deliberately
// excludes "dom" for every other file under src/main and src/preload
// (genuine Node/main-process context, no document/window ever exists
// there); this one runs inside a loaded web page instead, so it gets DOM
// typings via this directive alone rather than widening the whole project.
import { ipcRenderer } from "electron";

/**
 * Preload for the Browser tab's WebContentsView (main/browserTabView.ts) —
 * runs inside whatever arbitrary page got loaded there, sandboxed (unlike
 * the main app window's own preload/index.ts). Re-executes fresh on every
 * navigation (Electron reruns a view's preload per document load), so
 * there's never stale state to clean up between pages — each load starts
 * with `active = false` and no listeners attached until asked.
 *
 * Picking only ever reports data back over `ipcRenderer.send` — this file
 * never calls `contextBridge.exposeInMainWorld`, so the loaded page's own
 * JS has no way to see or trigger any of this.
 */

type PickedElement = {
  tag: string;
  id?: string;
  classes?: string;
  selector: string;
  text: string;
  outerHtml: string;
  rect: { x: number; y: number; width: number; height: number };
  pageUrl: string;
  pageTitle: string;
};

let overlay: HTMLDivElement | null = null;
let active = false;

function ensureOverlay(): HTMLDivElement {
  if (overlay && document.documentElement.contains(overlay)) return overlay;
  overlay = document.createElement("div");
  const style = overlay.style;
  style.position = "fixed";
  style.zIndex = "2147483647";
  style.pointerEvents = "none";
  style.border = "2px solid #6bd08a";
  style.background = "rgba(107, 208, 138, 0.15)";
  style.borderRadius = "2px";
  style.display = "none";
  style.boxSizing = "border-box";
  document.documentElement.appendChild(overlay);
  return overlay;
}

// Cheap, best-effort — not aiming for the shortest *unique* selector (that
// needs `document.querySelectorAll` uniqueness-checking, more than this
// picker needs), just a readable enough one, id if present or up to 5
// tag(.class)[:nth-of-type] ancestor hops.
function cssSelectorFor(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < 5; depth++) {
    let part = node.tagName.toLowerCase();
    if (node.classList.length > 0) {
      part += [...node.classList]
        .slice(0, 2)
        .map((c) => `.${CSS.escape(c)}`)
        .join("");
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTagSiblings = [...parent.children].filter((c) => c.tagName === node!.tagName);
      if (sameTagSiblings.length > 1) part += `:nth-of-type(${sameTagSiblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    if (node.id) {
      parts[0] = `#${CSS.escape(node.id)}`;
      break;
    }
    node = parent;
  }
  return parts.join(" > ");
}

function onMouseMove(e: MouseEvent): void {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const rect = target.getBoundingClientRect();
  const el = ensureOverlay();
  el.style.display = "block";
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}

function onClick(e: MouseEvent): void {
  // Capture-phase + preventDefault/stopPropagation: picking an element must
  // never also trigger it (a link navigating away mid-pick, a button
  // submitting a form) — same "the click means 'select', not 'use'" posture
  // a real DOM inspector's picker takes.
  e.preventDefault();
  e.stopPropagation();
  const target = e.target;
  if (!(target instanceof Element)) return;

  const rect = target.getBoundingClientRect();
  const picked: PickedElement = {
    tag: target.tagName.toLowerCase(),
    id: target.id || undefined,
    classes: typeof target.className === "string" && target.className ? target.className : undefined,
    selector: cssSelectorFor(target),
    text: (target.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 200),
    outerHtml: target.outerHTML.slice(0, 500),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    pageUrl: location.href,
    pageTitle: document.title,
  };
  ipcRenderer.send("browserTab:elementPicked", picked);
  stopPicking();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    stopPicking();
    ipcRenderer.send("browserTab:pickCancelled");
  }
}

function startPicking(): void {
  if (active) return;
  active = true;
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.body?.style.setProperty("cursor", "crosshair", "important");
}

function stopPicking(): void {
  if (!active) return;
  active = false;
  document.removeEventListener("mousemove", onMouseMove, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKeyDown, true);
  document.body?.style.removeProperty("cursor");
  if (overlay) overlay.style.display = "none";
}

ipcRenderer.on("browserTab:startPick", startPicking);
ipcRenderer.on("browserTab:stopPick", stopPicking);
