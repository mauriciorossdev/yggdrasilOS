import type { editor as MonacoEditorNS } from "monaco-editor";

// All of these mutate through editor.executeEdits so the change lands on
// Monaco's own undo stack (a single Cmd/Ctrl+Z undoes the toolbar action),
// rather than going through the `value`/`onChange` prop round-trip.

export function wrapSelection(editor: MonacoEditorNS.IStandaloneCodeEditor, prefix: string, suffix = prefix): void {
  const selection = editor.getSelection();
  const model = editor.getModel();
  if (!selection || !model) return;

  const text = model.getValueInRange(selection);
  const startOffset = model.getOffsetAt(selection.getStartPosition());
  editor.executeEdits("markdown-toolbar", [
    { range: selection, text: `${prefix}${text}${suffix}`, forceMoveMarkers: true },
  ]);

  // Re-select the (possibly still empty) inner text, cursor-in-the-middle,
  // so typing immediately after clicking replaces it — matches the usual
  // bold/italic-button behavior in most markdown editors.
  const innerStart = model.getPositionAt(startOffset + prefix.length);
  const innerEnd = model.getPositionAt(startOffset + prefix.length + text.length);
  editor.setSelection({
    startLineNumber: innerStart.lineNumber,
    startColumn: innerStart.column,
    endLineNumber: innerEnd.lineNumber,
    endColumn: innerEnd.column,
  });
  editor.focus();
}

export function prefixLines(editor: MonacoEditorNS.IStandaloneCodeEditor, prefix: string): void {
  const selection = editor.getSelection();
  if (!selection) return;

  const edits: MonacoEditorNS.IIdentifiedSingleEditOperation[] = [];
  for (let line = selection.startLineNumber; line <= selection.endLineNumber; line++) {
    edits.push({
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      text: prefix,
      forceMoveMarkers: true,
    });
  }
  editor.executeEdits("markdown-toolbar", edits);
  editor.focus();
}

/** Inserts (or replaces the current selection with) dictated text at the cursor, then places the cursor right after it. */
export function insertTextAtCursor(editor: MonacoEditorNS.IStandaloneCodeEditor, text: string): void {
  const selection = editor.getSelection();
  const model = editor.getModel();
  if (!selection || !model || !text) return;

  const startOffset = model.getOffsetAt(selection.getStartPosition());
  editor.executeEdits("mic-dictation", [{ range: selection, text, forceMoveMarkers: true }]);

  const end = model.getPositionAt(startOffset + text.length);
  editor.setPosition(end);
  editor.focus();
}

export function insertLink(editor: MonacoEditorNS.IStandaloneCodeEditor): void {
  const selection = editor.getSelection();
  const model = editor.getModel();
  if (!selection || !model) return;

  const label = model.getValueInRange(selection) || "link text";
  const startOffset = model.getOffsetAt(selection.getStartPosition());
  editor.executeEdits("markdown-toolbar", [
    { range: selection, text: `[${label}](url)`, forceMoveMarkers: true },
  ]);

  // Select the "url" placeholder so the user can immediately type the real
  // one over it — no window.prompt() (Electron's renderer doesn't support it).
  const urlStart = model.getPositionAt(startOffset + label.length + 3);
  const urlEnd = model.getPositionAt(startOffset + label.length + 3 + "url".length);
  editor.setSelection({
    startLineNumber: urlStart.lineNumber,
    startColumn: urlStart.column,
    endLineNumber: urlEnd.lineNumber,
    endColumn: urlEnd.column,
  });
  editor.focus();
}
