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
