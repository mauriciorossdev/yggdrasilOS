import { useEffect, useState } from "react";
import type { editor as MonacoEditorNS } from "monaco-editor";
import { CodeEditor } from "./CodeEditor.js";
import { MarkdownToolbar } from "./MarkdownToolbar.js";
import { MarkdownRichEditor } from "./MarkdownRichEditor.js";
import { languageFromPath } from "./languageFromPath.js";

type Props = {
  path: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
};

const DEFAULT_FONT_SIZE = 13;

// Plain files just get the code editor. .md files additionally get a
// formatting toolbar (bold/headings/lists/link — inserted as markdown
// syntax, for the raw-source side) plus a toggle for a WYSIWYG rich view
// (MarkdownRichEditor) where the rendered note itself is directly editable,
// since raw "# Heading" text doesn't actually look like a heading until
// rendered. Both sides edit the same markdown string; switching is lossless.
export function TextEditor({ path, value, onChange, readOnly }: Props) {
  const isMarkdown = languageFromPath(path) === "markdown";
  const [editor, setEditor] = useState<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
  const [previewing, setPreviewing] = useState(true);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);

  // Every newly opened doc starts in the rich/preview view, not raw source.
  useEffect(() => setPreviewing(true), [path]);

  if (!isMarkdown) {
    return <CodeEditor path={path} value={value} onChange={onChange} readOnly={readOnly} />;
  }

  return (
    <div className="text-editor">
      <MarkdownToolbar
        editor={editor}
        previewing={previewing}
        onTogglePreview={() => setPreviewing((p) => !p)}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
      />
      <div className="text-editor-body">
        {previewing ? (
          <div className="markdown-preview" style={{ fontSize }}>
            <MarkdownRichEditor path={path} value={value} onChange={onChange} readOnly={readOnly} />
          </div>
        ) : (
          <CodeEditor
            path={path}
            value={value}
            onChange={onChange}
            readOnly={readOnly}
            fontSize={fontSize}
            onMount={setEditor}
          />
        )}
      </div>
    </div>
  );
}
