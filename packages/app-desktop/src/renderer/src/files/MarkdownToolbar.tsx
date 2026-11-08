import { useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import type { editor as MonacoEditorNS } from "monaco-editor";
import {
  Bars3BottomLeftIcon,
  LinkIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PhotoIcon,
  TableCellsIcon,
} from "@heroicons/react/20/solid";
import { insertLink, insertTextAtCursor, runSourceCommand } from "./markdownEdits.js";
import { applyLink, currentLinkHref, isRichActive, runRichCommand, type FormatCommand } from "./richFormat.js";
import { LinkPopover } from "./LinkPopover.js";
import { MicButton } from "./MicButton.js";
import { useEditorTick } from "./useEditorTick.js";
import { imagesIn, insertImageFiles, storeImageFile } from "./insertImages.js";
import { insertTable, tableMarkdown } from "./tableControls.js";
import { useI18n, type MessageKey } from "../i18n/index.js";

type Props = {
  /** The open note's project-relative path: where an inserted image is stored (an `assets` folder next to it). */
  notePath: string;
  /** Which editor the buttons drive: the rich (TipTap) one or the raw-source (Monaco) one. */
  mode: "rich" | "source";
  rich: Editor | null;
  source: MonacoEditorNS.IStandaloneCodeEditor | null;
  readOnly?: boolean;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  /** Opens find (and replace) in whichever editor is showing. */
  onFind: () => void;
  outlineOpen: boolean;
  onToggleOutline: () => void;
};

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

type Item = { command: FormatCommand; title: MessageKey; label: ReactNode };

// Grouped the way people think of them; the separators between groups are drawn by the renderer.
const GROUPS: Item[][] = [
  [
    { command: "bold", title: "doc.fmt.bold", label: <strong>B</strong> },
    { command: "italic", title: "doc.fmt.italic", label: <em>i</em> },
    { command: "strike", title: "doc.fmt.strike", label: <s>S</s> },
  ],
  [
    { command: "h1", title: "doc.fmt.h1", label: "H1" },
    { command: "h2", title: "doc.fmt.h2", label: "H2" },
    { command: "h3", title: "doc.fmt.h3", label: "H3" },
  ],
  [
    { command: "bullet", title: "doc.fmt.bullet", label: <ListBulletIcon className="hero-icon" /> },
    { command: "ordered", title: "doc.fmt.ordered", label: "1." },
    { command: "task", title: "doc.fmt.task", label: "☑" },
    { command: "quote", title: "doc.fmt.quote", label: "”" },
  ],
  [
    { command: "code", title: "doc.fmt.code", label: "</>" },
    { command: "codeblock", title: "doc.fmt.codeblock", label: "{ }" },
    { command: "rule", title: "doc.fmt.rule", label: <MinusIcon className="hero-icon" /> },
  ],
];

export function MarkdownToolbar({ notePath, mode, rich, source, readOnly, fontSize, onFontSizeChange, onFind, outlineOpen, onToggleOutline }: Props) {
  const { t } = useI18n();
  useEditorTick(rich);
  const [linkOpen, setLinkOpen] = useState(false);
  const target = mode === "rich" ? rich : source;
  const disabled = !target || !!readOnly;

  const run = (command: FormatCommand) => {
    if (mode === "rich" && rich) runRichCommand(rich, command);
    else if (source) runSourceCommand(source, command);
  };

  const onLink = () => {
    if (mode === "rich" && rich) setLinkOpen((open) => !open);
    else if (source) insertLink(source);
  };

  const imageInput = useRef<HTMLInputElement>(null);

  // The picked images are stored next to the note and linked: as nodes in the rich view, as markdown in the source view.
  const onImagesPicked = async (files: File[]) => {
    const images = imagesIn(files);
    if (images.length === 0) return;
    if (mode === "rich" && rich) {
      await insertImageFiles(rich, notePath, images);
    } else if (source) {
      for (const file of images) {
        try {
          const { src, alt } = await storeImageFile(notePath, file);
          insertTextAtCursor(source, `![${alt}](${src})`);
        } catch (err) {
          window.alert(err instanceof Error ? err.message : String(err));
        }
      }
    }
  };

  const onTable = () => {
    if (mode === "rich" && rich) insertTable(rich);
    else if (source) insertTextAtCursor(source, tableMarkdown((n) => t("doc.table.column", { n })));
  };

  const insertDictation = (text: string) => {
    if (mode === "rich" && rich) rich.chain().focus().insertContent(text).run();
    else if (source) insertTextAtCursor(source, text);
  };

  return (
    <div className="markdown-toolbar">
      {GROUPS.map((group, i) => (
        <span key={group[0]!.command} className="markdown-toolbar-group">
          {i > 0 && <span className="markdown-toolbar-sep" />}
          {group.map((item) => {
            const active = mode === "rich" && rich ? isRichActive(rich, item.command) : false;
            return (
              <button
                key={item.command}
                type="button"
                disabled={disabled}
                title={t(item.title)}
                aria-label={t(item.title)}
                aria-pressed={active}
                className={active ? "active" : ""}
                // Keep the selection in the document: a button press must not steal focus from the editor.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(item.command)}
              >
                {item.label}
              </button>
            );
          })}
        </span>
      ))}
      <span className="markdown-toolbar-group">
        <span className="markdown-toolbar-sep" />
        <button
          type="button"
          disabled={disabled}
          title={t("doc.link")}
          aria-label={t("doc.link")}
          aria-pressed={mode === "rich" && !!rich && rich.isActive("link")}
          className={mode === "rich" && rich?.isActive("link") ? "active" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onLink}
        >
          <LinkIcon className="hero-icon" />
        </button>
        <MicButton disabled={disabled} onTranscript={insertDictation} />
      </span>
      <span className="markdown-toolbar-group">
        <span className="markdown-toolbar-sep" />
        <button type="button" disabled={disabled} title={t("doc.tb.insertImage")} aria-label={t("doc.tb.insertImage")} onMouseDown={(e) => e.preventDefault()} onClick={() => imageInput.current?.click()}>
          <PhotoIcon className="hero-icon" />
        </button>
        <button type="button" disabled={disabled} title={t("doc.tb.insertTable")} aria-label={t("doc.tb.insertTable")} onMouseDown={(e) => e.preventDefault()} onClick={onTable}>
          <TableCellsIcon className="hero-icon" />
        </button>
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label={t("doc.tb.pickImages")}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void onImagesPicked(files);
          }}
        />
      </span>
      <span className="markdown-toolbar-spacer" />
      <button type="button" title={t("doc.tb.findTitle")} aria-label={t("doc.find.placeholder")} onClick={onFind}>
        <MagnifyingGlassIcon className="hero-icon" />
      </button>
      <button
        type="button"
        title={outlineOpen ? t("doc.tb.hideOutline") : t("doc.tb.showOutline")}
        aria-label={outlineOpen ? t("doc.tb.hideOutline") : t("doc.tb.showOutline")}
        aria-pressed={outlineOpen}
        className={outlineOpen ? "active" : ""}
        onClick={onToggleOutline}
      >
        <Bars3BottomLeftIcon className="hero-icon" />
      </button>
      <span className="markdown-toolbar-sep" />
      <button
        type="button"
        title={t("doc.tb.smaller")}
        aria-label={t("doc.tb.smaller")}
        onClick={() => onFontSizeChange(Math.max(MIN_FONT_SIZE, fontSize - 1))}
      >
        A-
      </button>
      <button
        type="button"
        title={t("doc.tb.larger")}
        aria-label={t("doc.tb.larger")}
        onClick={() => onFontSizeChange(Math.min(MAX_FONT_SIZE, fontSize + 1))}
      >
        A+
      </button>
      {linkOpen && rich && mode === "rich" && (
        <LinkPopover
          initialHref={currentLinkHref(rich)}
          onApply={(href) => applyLink(rich, href)}
          onClose={() => setLinkOpen(false)}
        />
      )}
    </div>
  );
}
