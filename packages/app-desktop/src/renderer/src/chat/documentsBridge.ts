/** Same pub-sub shape as mainTabsBridge.ts — lets something outside DocumentsView (a terminal pane's file-path link click) open a tab there without lifting DocumentsView's own tab state. */
type Listener = (relativePath: string) => void;

let listener: Listener | null = null;

export function onRequestOpenDocument(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function requestOpenDocument(relativePath: string): void {
  listener?.(relativePath);
}
