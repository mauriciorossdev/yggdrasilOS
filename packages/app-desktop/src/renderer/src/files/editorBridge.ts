// The two things views outside the editor need from Monaco, without importing it. The editor chunk
// registers them when it loads; until then there are no editors or models, so doing nothing is right.
export type EditorBridge = {
  releaseModel(path: string): void;
  contentToSave(path: string, content: string): Promise<string>;
};

let bridge: EditorBridge | null = null;

export function registerEditorBridge(next: EditorBridge): void {
  bridge = next;
}

/** Drops a closed tab's model so language servers stop treating that file as open. */
export function releaseModel(path: string): void {
  bridge?.releaseModel(path);
}

/** What to write when the user saves `path`: formatted when that preference is on and an editor shows it. */
export function contentToSave(path: string, content: string): Promise<string> {
  return bridge ? bridge.contentToSave(path, content) : Promise.resolve(content);
}
