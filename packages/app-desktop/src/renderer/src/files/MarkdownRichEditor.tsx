import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { requestOpenDocument } from "../chat/documentsBridge.js";
import { requestTab } from "../chat/mainTabsBridge.js";

// tiptap-markdown puts its serializer on editor.storage.markdown; Tiptap 3's
// `Storage` interface is empty (v2's was Record<string, any>), so declare the one
// member we read.
declare module "@tiptap/core" {
  interface Storage {
    markdown: { getMarkdown(): string };
  }
}

type Props = {
  path: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
};

// No scheme (http:, mailto:, …) and not a bare in-page "#anchor" → a path
// into the vault, same convention as the terminal's PathLinkProvider.
function isInternalLink(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("#");
}

// Resolves a markdown link's relative href against the *linking* doc's own
// directory (standard relative-link semantics — "../db-schema.md" from
// "notes/Arquitectura/hl7-clcore/README.md" means
// "notes/Arquitectura/db-schema.md"), producing the same
// project-root-relative path fs.read/fs.write already use everywhere else.
function resolveRelativeDocPath(href: string, currentPath: string): string {
  const clean = href.split("#")[0]!.split("?")[0]!;
  const dir = currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : "";
  const segments = clean.startsWith("/") ? clean.split("/") : [...dir.split("/"), ...clean.split("/")];
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") stack.pop();
    else stack.push(segment);
  }
  return stack.join("/");
}

// WYSIWYG counterpart to CodeEditor's raw-source mode: the rendered note
// itself is directly editable (type on the heading, not on "# Heading"),
// with edits serialized straight back to the same markdown string
// TextEditor already round-trips through fs.read/fs.write — so switching
// between this and the raw source view is lossless either way.
export function MarkdownRichEditor({ path, value, onChange, readOnly }: Props) {
  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      // Tiptap 3's StarterKit bundles Link and Underline; keep Link configured
      // below (a second one would be a duplicate extension) and leave Underline
      // out so markdown round-trips exactly as before.
      StarterKit.configure({ link: false, underline: false }),
      // openOnClick: false — the extension's own click-to-open plugin always
      // sends the raw href to window.open(), which would hand a relative
      // path like "../db-schema.md" to Electron's setWindowOpenHandler /
      // shell.openExternal and go nowhere. The editorProps.handleClick
      // below replaces it: internal vault links open in this same
      // Documents panel, external ones still go to window.open (→ OS
      // browser, same as everywhere else in the app).
      Link.configure({ openOnClick: false, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      // Without these, `- [x] task` parses as plain text and is serialized back
      // as `- \[x\] task`, which silently breaks feature-doc task progress.
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
    ],
    content: value,
    editorProps: {
      attributes: { class: "markdown" },
      // Same DOM-walk @tiptap/extension-link's own (disabled) clickHandler
      // uses to find the <a> under the click, stopping at the editor's own
      // root DIV.
      handleClick: (view, _pos, event) => {
        if (event.button !== 0 || !view.editable) return false;
        const chain: HTMLElement[] = [];
        let node = event.target as HTMLElement | null;
        while (node && node.nodeName !== "DIV") {
          chain.push(node);
          node = node.parentElement;
        }
        const anchor = chain.find((el) => el.nodeName === "A") as HTMLAnchorElement | undefined;
        if (!anchor) return false;
        const href = anchor.getAttribute("href");
        if (!href) return false;
        if (isInternalLink(href)) {
          requestOpenDocument(resolveRelativeDocPath(href, path));
          requestTab("documents");
        } else {
          window.open(anchor.href, anchor.target || "_blank", "noopener");
        }
        return true;
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.storage.markdown.getMarkdown()),
  });

  // Reloads content on file switch (and on the initial async fs.read landing
  // after mount). Skipped while this editor has focus so an external
  // re-render mid-keystroke can't clobber the cursor/selection — the only
  // writer while focused is this editor's own onUpdate.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    if (editor.storage.markdown.getMarkdown() !== value) editor.commands.setContent(value, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, path, value]);

  useEffect(() => {
    // setEditable's default emitUpdate=true fires onUpdate (→ onChange) even
    // though nothing in the doc changed — without `false` here, every doc
    // got marked dirty the instant it opened (this effect runs once right
    // at mount, when `editor` first becomes non-null), never from an actual
    // edit.
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  return <EditorContent editor={editor} className="markdown-rich-editor" />;
}
