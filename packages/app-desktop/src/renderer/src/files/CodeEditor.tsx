import { useEffect, type ComponentProps } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useGateway } from "@yggdrasil/client-web";
import { YGG_MONACO_THEME, ensureYggTheme } from "./monacoSetup.js";
import { languageFromPath } from "./languageFromPath.js";
import { ensureImageHover } from "./monacoImageHover.js";
import { useEditorPrefs } from "./editorPrefs.js";
import { attachLspGateway, modelPathFor, revealPending } from "./lsp/service.js";

type Props = {
  path: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  /** Overrides the preference (the markdown toolbar has its own size control). */
  fontSize?: number;
  onMount?: OnMount;
};

// `path` (not just a `key`) is what lets Monaco keep a separate model — its
// own undo stack, cursor, scroll position — per file automatically, so
// callers with multiple open files (DocumentsView's tab strip) can reuse one
// mounted <CodeEditor> and just swap path/value on tab switch.
export function CodeEditor({ path, value, onChange, readOnly, fontSize, onMount }: Props) {
  const prefs = useEditorPrefs();
  const { call, onEvent } = useGateway();
  useEffect(() => attachLspGateway(call, onEvent as Parameters<typeof attachLspGateway>[1]), [call, onEvent]);
  const handleMount: NonNullable<ComponentProps<typeof Editor>["onMount"]> = (editor, monaco) => {
    revealPending(editor);
    editor.onDidChangeModel(() => revealPending(editor));
    onMount?.(editor, monaco);
  };
  return (
    <Editor
      path={modelPathFor(path)}
      language={languageFromPath(path)}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={handleMount}
      theme={YGG_MONACO_THEME}
      beforeMount={(monaco) => {
        ensureYggTheme();
        ensureImageHover(monaco);
      }}
      options={{
        readOnly,
        minimap: { enabled: prefs.minimap },
        fontSize: fontSize ?? prefs.fontSize,
        tabSize: prefs.tabSize,
        automaticLayout: true,
        wordWrap: prefs.wordWrap ? "on" : "off",
        scrollBeyondLastLine: false,
        bracketPairColorization: { enabled: true },
        // Overloads and the like give several targets; F12 should still just jump.
        gotoLocation: { multipleDefinitions: "goto", multipleTypeDefinitions: "goto" },
      }}
    />
  );
}
