import type { Editor } from "@tiptap/react";

/** What the formatting toolbar can do; the same names drive the raw-source (Monaco) side. */
export type FormatCommand =
  | "bold"
  | "italic"
  | "strike"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "code"
  | "codeblock"
  | "rule";

/** Applies a toolbar command to the rich (TipTap) editor, keeping the selection and focus. */
export function runRichCommand(editor: Editor, command: FormatCommand): void {
  const chain = editor.chain().focus();
  switch (command) {
    case "bold":
      chain.toggleBold().run();
      break;
    case "italic":
      chain.toggleItalic().run();
      break;
    case "strike":
      chain.toggleStrike().run();
      break;
    case "h1":
    case "h2":
    case "h3":
      chain.toggleHeading({ level: Number(command[1]) as 1 | 2 | 3 }).run();
      break;
    case "bullet":
      chain.toggleBulletList().run();
      break;
    case "ordered":
      chain.toggleOrderedList().run();
      break;
    case "task":
      chain.toggleTaskList().run();
      break;
    case "quote":
      chain.toggleBlockquote().run();
      break;
    case "code":
      chain.toggleCode().run();
      break;
    case "codeblock":
      chain.toggleCodeBlock().run();
      break;
    case "rule":
      chain.setHorizontalRule().run();
      break;
  }
}

/** Whether the cursor/selection is inside the thing the command toggles (the button's pressed state). */
export function isRichActive(editor: Editor, command: FormatCommand): boolean {
  switch (command) {
    case "bold":
      return editor.isActive("bold");
    case "italic":
      return editor.isActive("italic");
    case "strike":
      return editor.isActive("strike");
    case "h1":
    case "h2":
    case "h3":
      return editor.isActive("heading", { level: Number(command[1]) });
    case "bullet":
      return editor.isActive("bulletList");
    case "ordered":
      return editor.isActive("orderedList");
    case "task":
      return editor.isActive("taskList");
    case "quote":
      return editor.isActive("blockquote");
    case "code":
      return editor.isActive("code");
    case "codeblock":
      return editor.isActive("codeBlock");
    case "rule":
      return false;
  }
}

/** The link under the cursor, if any: its href, used to prefill the link popover. */
export function currentLinkHref(editor: Editor): string {
  return (editor.getAttributes("link").href as string | undefined) ?? "";
}

/**
 * Sets (or, with an empty href, removes) the link on the selection. With nothing selected
 * and no link under the cursor the URL itself is inserted as the linked text.
 */
export function applyLink(editor: Editor, href: string): void {
  const url = href.trim();
  const chain = editor.chain().focus();
  if (!url) {
    chain.extendMarkRange("link").unsetLink().run();
    return;
  }
  if (editor.state.selection.empty && !editor.isActive("link")) {
    chain.insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run();
    return;
  }
  chain.extendMarkRange("link").setLink({ href: url }).run();
}
