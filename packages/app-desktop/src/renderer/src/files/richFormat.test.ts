import { describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { applyLink, isRichActive, runRichCommand, type FormatCommand } from "./richFormat.js";

/** A stand-in for TipTap's editor: records which chain methods were called. */
function fakeEditor(opts: { active?: Record<string, boolean>; selectionEmpty?: boolean; href?: string } = {}) {
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  const record = (name: string) => (...args: unknown[]) => {
    calls.push(args.length ? `${name}(${JSON.stringify(args[0])})` : name);
    return chain;
  };
  for (const m of [
    "focus", "toggleBold", "toggleItalic", "toggleStrike", "toggleHeading", "toggleBulletList", "toggleOrderedList",
    "toggleTaskList", "toggleBlockquote", "toggleCode", "toggleCodeBlock", "setHorizontalRule", "extendMarkRange",
    "unsetLink", "setLink", "insertContent",
  ]) chain[m] = record(m);
  chain.run = () => true;
  const editor = {
    chain: () => chain,
    isActive: vi.fn((name: string) => opts.active?.[name] ?? false),
    getAttributes: () => ({ href: opts.href }),
    state: { selection: { empty: opts.selectionEmpty ?? false } },
  };
  return { editor: editor as unknown as Editor, calls, isActive: editor.isActive };
}

describe("runRichCommand", () => {
  const expected: Record<FormatCommand, string> = {
    bold: "toggleBold",
    italic: "toggleItalic",
    strike: "toggleStrike",
    h1: 'toggleHeading({"level":1})',
    h2: 'toggleHeading({"level":2})',
    h3: 'toggleHeading({"level":3})',
    bullet: "toggleBulletList",
    ordered: "toggleOrderedList",
    task: "toggleTaskList",
    quote: "toggleBlockquote",
    code: "toggleCode",
    codeblock: "toggleCodeBlock",
    rule: "setHorizontalRule",
  };

  for (const [command, call] of Object.entries(expected)) {
    it(`${command} focuses the editor and runs ${call}`, () => {
      const { editor, calls } = fakeEditor();
      runRichCommand(editor, command as FormatCommand);
      expect(calls).toEqual(["focus", call]);
    });
  }
});

describe("isRichActive", () => {
  it("maps each command to the node or mark it toggles", () => {
    const { editor, isActive } = fakeEditor({ active: { bold: true, heading: true } });
    expect(isRichActive(editor, "bold")).toBe(true);
    expect(isRichActive(editor, "italic")).toBe(false);
    expect(isRichActive(editor, "h2")).toBe(true);
    expect(isActive).toHaveBeenLastCalledWith("heading", { level: 2 });
    expect(isRichActive(editor, "bullet")).toBe(false);
    expect(isActive).toHaveBeenLastCalledWith("bulletList");
    expect(isRichActive(editor, "task")).toBe(false);
    expect(isActive).toHaveBeenLastCalledWith("taskList");
  });

  it("a horizontal rule is never 'pressed'", () => {
    expect(isRichActive(fakeEditor().editor, "rule")).toBe(false);
  });
});

describe("applyLink", () => {
  it("sets the href on the selection, extending over a link already there", () => {
    const { editor, calls } = fakeEditor({ selectionEmpty: false });
    applyLink(editor, "  https://example.com ");
    expect(calls).toEqual(["focus", 'extendMarkRange("link")', 'setLink({"href":"https://example.com"})']);
  });

  it("removes the link when the address is emptied", () => {
    const { editor, calls } = fakeEditor();
    applyLink(editor, "   ");
    expect(calls).toEqual(["focus", 'extendMarkRange("link")', "unsetLink"]);
  });

  it("with nothing selected and no link, inserts the address as linked text", () => {
    const { editor, calls } = fakeEditor({ selectionEmpty: true });
    applyLink(editor, "https://example.com");
    expect(calls[1]).toContain("insertContent");
    expect(calls[1]).toContain('"href":"https://example.com"');
  });

  it("with nothing selected but the cursor inside a link, edits that link", () => {
    const { editor, calls } = fakeEditor({ selectionEmpty: true, active: { link: true } });
    applyLink(editor, "https://new.example");
    expect(calls).toEqual(["focus", 'extendMarkRange("link")', 'setLink({"href":"https://new.example"})']);
  });
});
