/**
 * Same pub-sub shape as chat/documentsBridge.ts, for the full Files view:
 * lets a terminal pane's path link open a file or folder tab there.
 * A folder is passed as a folder tab key ("dir/", see folderTabs.ts).
 */
type Listener = (key: string, line?: number) => void;

let listener: Listener | null = null;

export function onRequestOpenInFiles(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function requestOpenInFiles(key: string, line?: number): void {
  listener?.(key, line);
}
