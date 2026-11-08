import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { SearchReplace } from "./searchReplace.js";
import { createImageNode } from "./imageNode.js";
import { displaySrc, resolveProjectPath } from "./imageSrc.js";
import { WikiLink } from "./wikiLinkExtension.js";
import { isAllowedLinkUri } from "./linkUri.js";
import { WikiLinkPopup } from "./WikiLinkPopup.js";
import type { WikiItem } from "../documents/notesIndex.js";
import { imageNodeFor, imagesIn, insertImageFiles } from "./insertImages.js";
import { isImageName, relativeFromNote, altFromFileName } from "./imageNames.js";
import { FILE_DRAG_MIME, type FileDragPayload } from "./dragMimeType.js";
import { requestOpenDocument } from "../chat/documentsBridge.js";
import { requestTab } from "../chat/mainTabsBridge.js";

// tiptap-markdown puts its serializer on editor.storage.markdown, and Tiptap 3's
// Storage interface starts empty, so declare the one member read here.
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
  /** Hands the editor instance to the parent (the formatting toolbar drives it); null when it unmounts. */
  onEditor?: (editor: Editor | null) => void;
  /** The notes `[[` offers to link; omitted where notes aren't linked (the picker stays off). */
  wikiItems?: WikiItem[];
};

// No scheme (http:, mailto:, …) and not a bare in-page "#anchor" → a path
// into the vault, same convention as the terminal's PathLinkProvider.
function isInternalLink(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("#");
}

// WYSIWYG counterpart to CodeEditor's raw-source mode: the rendered note
// itself is directly editable (type on the heading, not on "# Heading"),
// with edits serialized straight back to the same markdown string
// TextEditor already round-trips through fs.read/fs.write — so switching
// between this and the raw source view is lossless either way.
export function MarkdownRichEditor({ path, value, onChange, readOnly, onEditor, wikiItems }: Props) {
  // The editor outlives a file switch (its content is swapped), so the image node reads the current note's
  // path from a ref when it draws, to resolve `assets/a.png` against the right folder.
  const pathRef = useRef(path);
  pathRef.current = path;
  const editorRef = useRef<Editor | null>(null);
  const imageNode = useMemo(
    () => createImageNode((src) => displaySrc(pathRef.current, src, (projectPath) => window.yggdrasil.files.fileUrl(projectPath))),
    [],
  );

  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      // Tiptap 3's StarterKit adds Link and Underline. Link is configured below, and
      // leaving Underline out keeps the markdown round trip as it was.
      StarterKit.configure({ link: false, underline: false }),
      // openOnClick: false — the extension's own click-to-open plugin always
      // sends the raw href to window.open(), which would hand a relative
      // path like "../db-schema.md" to Electron's setWindowOpenHandler /
      // shell.openExternal and go nowhere. The editorProps.handleClick
      // below replaces it: internal vault links open in this same
      // Documents panel, external ones still go to window.open (→ OS
      // browser, same as everywhere else in the app).
      Link.configure({
        openOnClick: false,
        // TipTap refuses a relative path that starts with a folder name and draws the link with an empty href.
        isAllowedUri: (url, ctx) => isAllowedLinkUri(url, ctx.defaultValidate),
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      // Without these, `- [x] task` parses as plain text and is serialized back
      // as `- \[x\] task`, which silently breaks feature-doc task progress.
      TaskList,
      TaskItem.configure({ nested: true }),
      imageNode,
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
      SearchReplace,
      WikiLink,
    ],
    content: value,
    editorProps: {
      attributes: { class: "markdown" },
      // An image on the clipboard (a screenshot, a copied picture) is stored next to the note and linked.
      handlePaste: (view, event) => {
        const images = imagesIn(Array.from(event.clipboardData?.files ?? []));
        const editor = editorRef.current;
        if (images.length === 0 || !view.editable || !editor) return false;
        event.preventDefault();
        void insertImageFiles(editor, pathRef.current, images);
        return true;
      },
      // Images dropped from the OS are stored next to the note; an image dragged from the app's own file tree is
      // linked where it is. Anything else (moving text inside the editor, other files) is left to the default.
      handleDrop: (view, event, _slice, moved) => {
        const editor = editorRef.current;
        if (moved || !view.editable || !editor) return false;
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        const images = imagesIn(Array.from(event.dataTransfer?.files ?? []));
        if (images.length > 0) {
          event.preventDefault();
          void insertImageFiles(editor, pathRef.current, images, position);
          return true;
        }
        const raw = event.dataTransfer?.getData(FILE_DRAG_MIME);
        if (!raw) return false;
        try {
          const payload = JSON.parse(raw) as FileDragPayload;
          if (payload.type !== "file" || !isImageName(payload.relativePath)) return false;
          event.preventDefault();
          const node = imageNodeFor(relativeFromNote(pathRef.current, payload.relativePath), altFromFileName(payload.relativePath));
          const chain = editor.chain().focus();
          if (position === undefined) chain.insertContent(node).run();
          else chain.insertContentAt(position, node).run();
          return true;
        } catch {
          return false;
        }
      },
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
          // Relative to the linking note's folder, like any markdown link; %20 and the like decoded.
          const target = resolveProjectPath(pathRef.current, href);
          if (!target) return true;
          requestOpenDocument(target);
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
    editorRef.current = editor;
    onEditor?.(editor);
    return () => onEditor?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    // setEditable's default emitUpdate=true fires onUpdate (→ onChange) even
    // though nothing in the doc changed — without `false` here, every doc
    // got marked dirty the instant it opened (this effect runs once right
    // at mount, when `editor` first becomes non-null), never from an actual
    // edit.
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  return (
    <>
      <EditorContent editor={editor} className="markdown-rich-editor" />
      {editor && wikiItems && !readOnly && <WikiLinkPopup editor={editor} items={wikiItems} notePath={path} />}
    </>
  );
}
