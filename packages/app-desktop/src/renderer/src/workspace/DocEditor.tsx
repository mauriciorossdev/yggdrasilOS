import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import Image from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import type { DocModel } from "@yggdrasil/tool-office/browser";
import { useI18n } from "../i18n/index.js";
import { PageBreak } from "./pageBreakNode.js";
import { docToModel, modelToDoc } from "./docConvert.js";
import { countWords, describeBlocks, findMatches, markdownForModel, planWrite } from "./docOps.js";
import { failDocOpen, registerDocController, type DocController } from "./docRegistry.js";
import { lossyNames } from "./lossyNames.js";
import { openWorkspaceTab } from "./workspaceStore.js";

type Props = { path: string; active: boolean };
type SaveState = "saved" | "unsaved" | "saving" | "error";

const SAVE_DEBOUNCE_MS = 800;

// tiptap-markdown puts its parser/serializer on editor.storage.markdown (declared elsewhere only for getMarkdown).
type MarkdownStorage = { getMarkdown(): string; parser: { parse(markdown: string): string } };
const markdownOf = (editor: Editor): MarkdownStorage => (editor.storage as unknown as { markdown: MarkdownStorage }).markdown;

const extensions = [
  StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  Superscript,
  Subscript,
  Image.extend({
    addAttributes() {
      return { ...this.parent?.(), width: { default: null }, height: { default: null } };
    },
  }).configure({ allowBase64: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  PageBreak,
  Markdown.configure({ html: true, linkify: false, breaks: false, transformPastedText: false }),
];

/** Top-level block positions: where each one starts and ends inside the document. */
function blockRanges(editor: Editor): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  editor.state.doc.forEach((node, offset) => out.push({ from: offset, to: offset + node.nodeSize }));
  return out;
}

function controllerFor(editor: Editor, lossy: string[], flush: () => Promise<boolean>): DocController {
  const topLevel = () => {
    const nodes: Array<{ type: string; text: string }> = [];
    editor.state.doc.forEach((node) => nodes.push({ type: node.type.name, text: node.textContent }));
    return nodes;
  };
  return {
    info: () => ({ blocks: editor.state.doc.childCount, words: countWords(editor.state.doc.textContent) }),
    read: () => ({ blocks: describeBlocks(topLevel()), markdown: markdownForModel(markdownOf(editor).getMarkdown()) }),
    async write(op) {
      const ranges = blockRanges(editor);
      const plan = planWrite(op, ranges.length);
      const md = op.markdown ?? "";
      switch (plan.kind) {
        case "set-all":
          editor.commands.setContent(md);
          break;
        case "insert":
          editor.commands.insertContentAt(plan.at === "end" ? editor.state.doc.content.size : 0, md);
          break;
        case "insert-after":
          editor.commands.insertContentAt(ranges[plan.index]!.to, md);
          break;
        case "replace-block":
          editor.commands.insertContentAt({ from: ranges[plan.index]!.from, to: ranges[plan.index]!.to }, md);
          break;
        case "delete-block":
          editor.commands.deleteRange({ from: ranges[plan.index]!.from, to: ranges[plan.index]!.to });
          break;
      }
      const blocks = editor.state.doc.childCount;
      if (lossy.length > 0) {
        return { blocks, saved: false, note: `Not saved to the file: it has ${lossy.join(", ")}, which the editor can't keep yet. The change is on screen only; the user can save a copy.` };
      }
      // Report what really happened, not what was hoped for: a failed write is on screen only.
      return (await flush()) ? { blocks, saved: true } : { blocks, saved: false, note: "The change is on screen but saving the file failed; the user sees the error in the editor." };
    },
    findReplace(find, replace, all) {
      let replaced = 0;
      const { tr, doc } = editor.state;
      const hits: Array<{ from: number; to: number }> = [];
      doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        for (const [start, end] of findMatches(node.text, find, true)) hits.push({ from: pos + start, to: pos + end });
      });
      const chosen = all ? hits : hits.slice(0, 1);
      // From the end, so earlier positions stay valid while the text changes length.
      for (const hit of [...chosen].reverse()) {
        tr.insertText(replace, hit.from, hit.to);
        replaced++;
      }
      if (replaced > 0) editor.view.dispatch(tr);
      return { replaced };
    },
  };
}

const LABELS = {
  en: { undo: "Undo", redo: "Redo", bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough", paragraph: "Paragraph", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", bullets: "Bulleted list", numbers: "Numbered list", left: "Align left", center: "Center", right: "Align right", justify: "Justify", link: "Link", linkPrompt: "Link address (empty removes it)", table: "Insert table", pageBreak: "Page break", saved: "Saved" },
  es: { undo: "Deshacer", redo: "Rehacer", bold: "Negrita", italic: "Cursiva", underline: "Subrayado", strike: "Tachado", paragraph: "Párrafo", h1: "Título 1", h2: "Título 2", h3: "Título 3", bullets: "Lista con viñetas", numbers: "Lista numerada", left: "Alinear a la izquierda", center: "Centrar", right: "Alinear a la derecha", justify: "Justificar", link: "Enlace", linkPrompt: "Dirección del enlace (vacío lo quita)", table: "Insertar tabla", pageBreak: "Salto de página", saved: "Guardado" },
} as const;

function Toolbar({ editor, language }: { editor: Editor; language: "en" | "es" }) {
  const L = LABELS[language];
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      link: e.isActive("link"),
      heading: e.isActive("heading", { level: 1 }) ? "1" : e.isActive("heading", { level: 2 }) ? "2" : e.isActive("heading", { level: 3 }) ? "3" : "0",
      align: (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const btn = (label: string, on: boolean, run: () => void, text: string, disabled = false) => (
    <button type="button" className={`doc-tool${on ? " active" : ""}`} title={label} aria-label={label} aria-pressed={on} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {text}
    </button>
  );
  const chain = () => editor.chain().focus();
  return (
    <div className="doc-toolbar" role="toolbar">
      {btn(L.undo, false, () => chain().undo().run(), "↶", !s.canUndo)}
      {btn(L.redo, false, () => chain().redo().run(), "↷", !s.canRedo)}
      <select
        className="doc-heading-select"
        value={s.heading}
        aria-label={L.paragraph}
        onChange={(e) => (e.target.value === "0" ? chain().setParagraph().run() : chain().toggleHeading({ level: Number(e.target.value) as 1 | 2 | 3 }).run())}
      >
        <option value="0">{L.paragraph}</option>
        <option value="1">{L.h1}</option>
        <option value="2">{L.h2}</option>
        <option value="3">{L.h3}</option>
      </select>
      {btn(L.bold, s.bold, () => chain().toggleBold().run(), "B")}
      {btn(L.italic, s.italic, () => chain().toggleItalic().run(), "I")}
      {btn(L.underline, s.underline, () => chain().toggleUnderline().run(), "U")}
      {btn(L.strike, s.strike, () => chain().toggleStrike().run(), "S")}
      {btn(L.bullets, s.bullets, () => chain().toggleBulletList().run(), "•≡")}
      {btn(L.numbers, s.numbers, () => chain().toggleOrderedList().run(), "1.")}
      {btn(L.left, s.align === "left", () => chain().setTextAlign("left").run(), "⇤")}
      {btn(L.center, s.align === "center", () => chain().setTextAlign("center").run(), "↔")}
      {btn(L.right, s.align === "right", () => chain().setTextAlign("right").run(), "⇥")}
      {btn(L.justify, s.align === "justify", () => chain().setTextAlign("justify").run(), "☰")}
      {btn(
        L.link,
        s.link,
        () => {
          const href = window.prompt(L.linkPrompt, (editor.getAttributes("link").href as string | undefined) ?? "https://");
          if (href === null) return;
          if (href.trim() === "") chain().unsetLink().run();
          else chain().extendMarkRange("link").setLink({ href: href.trim() }).run();
        },
        "🔗",
      )}
      {btn(L.table, false, () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), "▦")}
      {btn(L.pageBreak, false, () => chain().insertContent({ type: "pageBreak" }).run(), "⏎")}
    </div>
  );
}

type Loaded = { model: DocModel; lossy: string[] };

/** One Word document in the workspace: edit it by hand, and an agent can read/write the same open document through its controller. Saves itself back to the .docx. */
export default function DocEditor({ path, active }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    window.yggdrasil.office.docLoad(path).then(
      (res) => !cancelled && setLoaded({ model: res.model as DocModel, lossy: res.lossy }),
      (err) => {
        if (cancelled) return;
        const failure = err instanceof Error ? err : new Error(String(err));
        failDocOpen(path, failure);
        setError(failure.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) return <p className="error sheet-error">{error}</p>;
  if (!loaded) return <p className="muted sheet-loading">…</p>;
  return <DocSurface path={path} active={active} initial={loaded.model} lossy={loaded.lossy} />;
}

function DocSurface({ path, active, initial, lossy }: { path: string; active: boolean; initial: DocModel; lossy: string[] }) {
  const { t, language } = useI18n();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copy, setCopy] = useState<{ path: string } | { error: string } | null>(null);
  const savedRef = useRef("");
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef = useRef<Editor | null>(null);
  const content = useMemo(() => modelToDoc(initial), [initial]);

  /** Writes the document now; resolves to whether what is on screen is on disk. */
  const save = async (): Promise<boolean> => {
    const editor = editorRef.current;
    if (!editor || lossy.length > 0) return false;
    clearTimeout(timerRef.current);
    const model = docToModel(editor.getJSON() as never);
    const signature = JSON.stringify(model);
    if (signature === savedRef.current) {
      dirtyRef.current = false;
      setSaveState("saved");
      return true;
    }
    setSaveState("saving");
    try {
      await window.yggdrasil.office.docSave(path, model);
      savedRef.current = signature;
      dirtyRef.current = false;
      setSaveError(null);
      setSaveState("saved");
      return true;
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const editor = useEditor({
    extensions,
    content,
    editorProps: { attributes: { class: "markdown doc-page" } },
    onUpdate: () => {
      if (lossy.length > 0) return;
      dirtyRef.current = true;
      setSaveState("unsaved");
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
    },
  });
  editorRef.current = editor;

  // Register for agent tool calls once the editor exists; what the editor shows right now is the baseline ("saved").
  useEffect(() => {
    if (!editor) return;
    savedRef.current = JSON.stringify(docToModel(editor.getJSON() as never));
    const unregister = registerDocController(path, controllerFor(editor, lossy, save));
    return () => {
      unregister();
      clearTimeout(timerRef.current);
      // Closing the tab right after an edit must not lose it.
      if (dirtyRef.current) void save();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, path]);

  const saveCopy = async () => {
    if (!editor) return;
    try {
      setCopy({ path: await window.yggdrasil.office.docSaveCopy(path, docToModel(editor.getJSON() as never)) });
    } catch (err) {
      setCopy({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const L = LABELS[language];
  return (
    <div className="doc-editor">
      {lossy.length > 0 && (
        <div className="sheet-lossy" role="alert">
          <span>{t("workspace.lossyBanner", { features: lossyNames(lossy, language) })}</span>
          <button type="button" onClick={() => void saveCopy()}>
            {t("workspace.saveCopy")}
          </button>
          {copy && "path" in copy && (
            <>
              <span className="muted">{t("workspace.copySaved", { path: copy.path })}</span>
              <button type="button" onClick={() => openWorkspaceTab("doc", copy.path)}>
                {t("workspace.openCopy")}
              </button>
            </>
          )}
          {copy && "error" in copy && <span className="error">{copy.error}</span>}
        </div>
      )}
      {editor && <Toolbar editor={editor} language={language} />}
      <div className="doc-scroll" data-active={active ? "1" : "0"}>
        <EditorContent editor={editor} />
      </div>
      {saveState === "error" && saveError && <span className="error sheet-save-message" role="alert">{saveError}</span>}
      <span className={`sheet-save sheet-save-${lossy.length > 0 ? "error" : saveState}`} title={saveState === "saved" ? L.saved : (saveError ?? undefined)}>
        {lossy.length > 0 ? "⚠" : saveState === "saved" ? "✓" : saveState === "saving" ? "…" : saveState === "unsaved" ? "●" : "!"}
      </span>
    </div>
  );
}
