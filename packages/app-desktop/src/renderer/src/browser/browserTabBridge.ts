/**
 * Same module-level pub-sub shape as terminal/terminalBridge.ts's
 * onTerminalTabVisible — MainTabs doesn't render BrowserTabView directly
 * (it's a sibling passed down as `browserContent` from ChatView), so it
 * can't just prop-drill "are you visible right now" into it. Needed
 * because a WebContentsView is a native layer Electron composites into the
 * window, not a DOM node — BrowserTabView must explicitly tell main to
 * attach/detach it (main/browserTabView.ts's show/hide) when the tab
 * becomes active/inactive; a plain CSS display:none on its placeholder div
 * (same as every other MainTabs panel) does nothing to that native layer.
 */
type VisibleListener = (visible: boolean) => void;

let visibleListener: VisibleListener | null = null;

export function onBrowserTabVisibleChange(fn: VisibleListener): () => void {
  visibleListener = fn;
  return () => {
    if (visibleListener === fn) visibleListener = null;
  };
}

export function notifyBrowserTabVisibleChange(visible: boolean): void {
  visibleListener?.(visible);
}

/**
 * A DOM popup (the sidebar's terminal-list flyout) wants to draw where the
 * native Browser view is: BrowserTabView freezes the page into a still image
 * and hides the view while `covered` is true, then restores it.
 */
type CoverListener = (covered: boolean) => void;

let coverListener: CoverListener | null = null;

export function onBrowserTabCoverChange(fn: CoverListener): () => void {
  coverListener = fn;
  return () => {
    if (coverListener === fn) coverListener = null;
  };
}

export function setBrowserTabCovered(covered: boolean): void {
  coverListener?.(covered);
}

/**
 * How many pixels of the window's right edge a floating side panel takes.
 * Stored, not just pushed: the Browser tab reads it whenever it reports its bounds.
 */
let occludedRight = 0;
let occlusionListener: (() => void) | null = null;

export function getBrowserTabOcclusion(): number {
  return occludedRight;
}

export function setBrowserTabOcclusion(width: number): void {
  if (width === occludedRight) return;
  occludedRight = width;
  occlusionListener?.();
}

export function onBrowserTabOcclusionChange(fn: () => void): () => void {
  occlusionListener = fn;
  return () => {
    if (occlusionListener === fn) occlusionListener = null;
  };
}
