import type { editor as MonacoEditorNS } from "monaco-editor";
import { EyeIcon, EyeSlashIcon, LinkIcon, ListBulletIcon } from "@heroicons/react/20/solid";
import { insertLink, insertTextAtCursor, prefixLines, wrapSelection } from "./markdownEdits.js";
import { MicButton } from "./MicButton.js";

type Props = {
  editor: MonacoEditorNS.IStandaloneCodeEditor | null;
  previewing: boolean;
  onTogglePreview: () => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
};

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

export function MarkdownToolbar({ editor, previewing, onTogglePreview, fontSize, onFontSizeChange }: Props) {
  const disabled = previewing || !editor;

  const run = (fn: (editor: MonacoEditorNS.IStandaloneCodeEditor) => void) => {
    if (editor) fn(editor);
  };

  return (
    <div className="markdown-toolbar">
      <button type="button" disabled={disabled} title="Bold" onClick={() => run((e) => wrapSelection(e, "**"))}>
        <strong>B</strong>
      </button>
      <button type="button" disabled={disabled} title="Italic" onClick={() => run((e) => wrapSelection(e, "_"))}>
        <em>i</em>
      </button>
      <span className="markdown-toolbar-sep" />
      <button type="button" disabled={disabled} title="Heading 1" onClick={() => run((e) => prefixLines(e, "# "))}>
        H1
      </button>
      <button type="button" disabled={disabled} title="Heading 2" onClick={() => run((e) => prefixLines(e, "## "))}>
        H2
      </button>
      <button type="button" disabled={disabled} title="Heading 3" onClick={() => run((e) => prefixLines(e, "### "))}>
        H3
      </button>
      <span className="markdown-toolbar-sep" />
      <button type="button" disabled={disabled} title="Bullet list" onClick={() => run((e) => prefixLines(e, "- "))}>
        <ListBulletIcon className="hero-icon" />
      </button>
      <button
        type="button"
        disabled={disabled}
        title="Numbered list"
        onClick={() => run((e) => prefixLines(e, "1. "))}
      >
        1.
      </button>
      <button type="button" disabled={disabled} title="Quote" onClick={() => run((e) => prefixLines(e, "> "))}>
        "
      </button>
      <span className="markdown-toolbar-sep" />
      <button type="button" disabled={disabled} title="Inline code" onClick={() => run((e) => wrapSelection(e, "`"))}>
        {"</>"}
      </button>
      <button
        type="button"
        disabled={disabled}
        title="Code block"
        onClick={() => run((e) => wrapSelection(e, "```\n", "\n```"))}
      >
        {"{ }"}
      </button>
      <button type="button" disabled={disabled} title="Link" onClick={() => run((e) => insertLink(e))}>
        <LinkIcon className="hero-icon" />
      </button>
      <span className="markdown-toolbar-sep" />
      <MicButton disabled={disabled} onTranscript={(text) => run((e) => insertTextAtCursor(e, text))} />
      <span className="markdown-toolbar-spacer" />
      <button
        type="button"
        title="Smaller text"
        onClick={() => onFontSizeChange(Math.max(MIN_FONT_SIZE, fontSize - 1))}
      >
        A-
      </button>
      <button
        type="button"
        title="Larger text"
        onClick={() => onFontSizeChange(Math.min(MAX_FONT_SIZE, fontSize + 1))}
      >
        A+
      </button>
      <button
        type="button"
        className={previewing ? "active" : ""}
        title={previewing ? "Switch to raw markdown source" : "Switch to rich (WYSIWYG) view"}
        onClick={onTogglePreview}
      >
        {previewing ? <EyeSlashIcon className="hero-icon" /> : <EyeIcon className="hero-icon" />}
      </button>
    </div>
  );
}
