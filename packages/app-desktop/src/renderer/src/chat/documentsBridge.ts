/** Same pub-sub shape as mainTabsBridge.ts — lets something outside DocumentsView (a terminal pane's file-path link click) open a tab there without lifting DocumentsView's own tab state. */
/** `line` (1-based) comes from a `path:42` locator; a folder is passed as a folder tab key ("dir/"). */
type Listener = (relativePath: string, line?: number) => void;

let listener: Listener | null = null;

export function onRequestOpenDocument(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function requestOpenDocument(relativePath: string, line?: number): void {
  listener?.(relativePath, line);
}
