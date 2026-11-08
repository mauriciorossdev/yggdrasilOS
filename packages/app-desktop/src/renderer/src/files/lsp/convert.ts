import type { Diagnostic, Range as LspRange, TextEdit } from "vscode-languageserver-protocol";

/** A Monaco range: 1-based, where LSP is 0-based. Both count columns in UTF-16 units. */
export type MonacoRange = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };

export function toMonacoRange(range: LspRange): MonacoRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

export function toLspRange(range: MonacoRange): LspRange {
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
  };
}

// Names, not numbers: the two enums count differently, so these get looked up in Monaco's by name.
const COMPLETION_KINDS = [
  "Text", "Method", "Function", "Constructor", "Field", "Variable", "Class", "Interface", "Module", "Property", "Unit",
  "Value", "Enum", "Keyword", "Snippet", "Color", "File", "Reference", "Folder", "EnumMember", "Constant", "Struct",
  "Event", "Operator", "TypeParameter",
] as const;

const SYMBOL_KINDS = [
  "File", "Module", "Namespace", "Package", "Class", "Method", "Property", "Field", "Constructor", "Enum", "Interface",
  "Function", "Variable", "Constant", "String", "Number", "Boolean", "Array", "Object", "Key", "Null", "EnumMember",
  "Struct", "Event", "Operator", "TypeParameter",
] as const;

export function completionKindName(kind: number | undefined): (typeof COMPLETION_KINDS)[number] {
  return COMPLETION_KINDS[(kind ?? 1) - 1] ?? "Text";
}

export function symbolKindName(kind: number): (typeof SYMBOL_KINDS)[number] {
  return SYMBOL_KINDS[kind - 1] ?? "Variable";
}

/** LSP 3.18 lets a diagnostic's message be markup; markers only show plain text. */
export function diagnosticMessage(diagnostic: Diagnostic): string {
  const message: unknown = diagnostic.message;
  return typeof message === "string" ? message : (message as { value: string }).value;
}

// monaco.MarkerSeverity values, by LSP DiagnosticSeverity (Error, Warning, Information, Hint).
const MARKER_SEVERITY = [8, 4, 2, 1];

/** Fields of monaco.editor.IMarkerData; `tags` 1 = unnecessary, 2 = deprecated, the same in both. */
export function toMarker(diagnostic: Diagnostic) {
  const code = diagnostic.code === undefined ? undefined : String(diagnostic.code);
  return {
    ...toMonacoRange(diagnostic.range),
    severity: MARKER_SEVERITY[(diagnostic.severity ?? 1) - 1] ?? 8,
    message: diagnosticMessage(diagnostic),
    source: diagnostic.source,
    code: code && diagnostic.codeDescription ? { value: code, target: undefined as never } : code,
    tags: diagnostic.tags as number[] | undefined,
  };
}

/** Identifies a diagnostic again when Monaco hands back the marker made from it, for code actions. */
export function diagnosticKey(range: MonacoRange, message: string): string {
  return `${range.startLineNumber}:${range.startColumn}:${range.endLineNumber}:${range.endColumn}:${message}`;
}

function offsetAt(text: string, lineStarts: number[], position: { line: number; character: number }): number {
  if (position.line >= lineStarts.length) return text.length;
  const start = lineStarts[position.line]!;
  const next = lineStarts[position.line + 1] ?? text.length + 1;
  return Math.min(start + position.character, next - 1, text.length);
}

/** Applies LSP edits to text that isn't in an editor. Their positions all refer to the original text. */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }
  const located = edits
    .map((edit, index) => ({
      start: offsetAt(text, lineStarts, edit.range.start),
      end: offsetAt(text, lineStarts, edit.range.end),
      newText: edit.newText,
      index,
    }))
    // Same-place inserts keep their given order.
    .sort((a, b) => a.start - b.start || a.index - b.index);
  let out = "";
  let cursor = 0;
  for (const edit of located) {
    if (edit.start < cursor) throw new Error("overlapping edits");
    out += text.slice(cursor, edit.start) + edit.newText;
    cursor = edit.end;
  }
  return out + text.slice(cursor);
}

/** A project-relative path for an absolute one, or null if it's outside the project. */
export function relativeIfInside(path: string, root: string): string | null {
  const normalize = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const file = normalize(path);
  const base = normalize(root);
  // Windows paths compare case-insensitively (Monaco lowercases the drive letter).
  const windows = /^[a-z]:/i.test(base);
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!same(file.slice(0, base.length), base) || file[base.length] !== "/") return null;
  return file.slice(base.length + 1);
}

/** The languageId servers expect: Monaco has one language for .ts and .tsx, but tsserver needs to tell JSX apart. */
export function lspLanguageId(path: string, monacoLanguage: string): string {
  if (/\.tsx$/i.test(path)) return "typescriptreact";
  if (/\.jsx$/i.test(path)) return "javascriptreact";
  return monacoLanguage;
}
