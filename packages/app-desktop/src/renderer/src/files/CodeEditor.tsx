import Editor, { type OnMount } from "@monaco-editor/react";
import { YGG_MONACO_THEME, ensureYggTheme } from "./monacoSetup.js";
import { languageFromPath } from "./languageFromPath.js";

type Props = {
  path: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  fontSize?: number;
  onMount?: OnMount;
};

// `path` (not just a `key`) is what lets Monaco keep a separate model — its
// own undo stack, cursor, scroll position — per file automatically, so
// callers with multiple open files (DocumentsView's tab strip) can reuse one
// mounted <CodeEditor> and just swap path/value on tab switch.
export function CodeEditor({ path, value, onChange, readOnly, fontSize = 13, onMount }: Props) {
  return (
    <Editor
      path={path}
      language={languageFromPath(path)}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={onMount}
      theme={YGG_MONACO_THEME}
      beforeMount={() => ensureYggTheme()}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize,
        automaticLayout: true,
        wordWrap: "on",
        scrollBeyondLastLine: false,
        // These call out to worker RPC methods (findDocumentSymbols,
        // getFoldingRanges, findDocumentColors) that monacoSetup.ts's single
        // generic editor.worker doesn't implement — with them on, Monaco
        // throws uncaught worker errors in the console on every keystroke.
        // Turning the requesting features off (rather than wiring up
        // per-language workers) matches this editor's actual scope: quick
        // edits, not a full IDE.
        stickyScroll: { enabled: false },
        folding: false,
        colorDecorators: false,
      }}
    />
  );
}
