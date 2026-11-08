import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Node } from "@tiptap/pm/model";
import { computeWikiState } from "./wikiLinkExtension.js";

const schema = getSchema([StarterKit]);

function docWith(...blocks: Array<{ type: string; content?: unknown[] }>): Node {
  return Node.fromJSON(schema, { type: "doc", content: blocks });
}
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string, marks?: unknown[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });

/** A state with the cursor at the end of the first text block's text (or at `offset` characters into it). */
function stateAt(doc: Node, offset?: number): EditorState {
  const state = EditorState.create({ doc });
  const pos = 1 + (offset ?? doc.firstChild!.content.size);
  return state.apply(state.tr.setSelection(TextSelection.create(doc, pos)));
}

describe("computeWikiState", () => {
  it("opens at an unfinished [[ with the range it occupies and what was typed", () => {
    const doc = docWith(para(text("Ver [[contr")));
    const state = computeWikiState(stateAt(doc), null);
    expect(state).toMatchObject({ query: "contr", selected: 0, dismissed: false });
    expect(doc.textBetween(state!.from, state!.to)).toBe("[[contr");
  });

  it("is closed with no trigger, after a closed link, or for a range selection", () => {
    expect(computeWikiState(stateAt(docWith(para(text("sin nada")))), null)).toBeNull();
    expect(computeWikiState(stateAt(docWith(para(text("Ver [[a]]")))), null)).toBeNull();
    const doc = docWith(para(text("Ver [[contr")));
    const ranged = EditorState.create({ doc });
    expect(computeWikiState(ranged.apply(ranged.tr.setSelection(TextSelection.create(doc, 2, 6))), null)).toBeNull();
  });

  it("ignores a trigger inside a code block or inline code", () => {
    expect(computeWikiState(stateAt(docWith({ type: "codeBlock", content: [text("[[x")] })), null)).toBeNull();
    expect(computeWikiState(stateAt(docWith(para(text("[[x", [{ type: "code" }])))), null)).toBeNull();
  });

  it("lines up with positions when a hard break comes first", () => {
    const doc = docWith(para(text("antes"), { type: "hardBreak" }, text("[[tit")));
    const state = computeWikiState(stateAt(doc), null);
    expect(doc.textBetween(state!.from, state!.to)).toBe("[[tit");
  });

  it("keeps the highlighted item while typing, and resets it for a new trigger", () => {
    const first = computeWikiState(stateAt(docWith(para(text("Ver [[a")))), null, { selected: 2 });
    expect(first!.selected).toBe(2);
    const more = computeWikiState(stateAt(docWith(para(text("Ver [[ab")))), first);
    expect(more!.selected).toBe(2);
    const elsewhere = computeWikiState(stateAt(docWith(para(text("Otro texto más largo [[a")))), first);
    expect(elsewhere!.selected).toBe(0);
  });

  it("stays dismissed for the same trigger and comes back for a different one", () => {
    const open = computeWikiState(stateAt(docWith(para(text("Ver [[a")))), null);
    const closed = computeWikiState(stateAt(docWith(para(text("Ver [[a")))), open, { dismiss: true });
    expect(closed!.dismissed).toBe(true);
    expect(computeWikiState(stateAt(docWith(para(text("Ver [[ab")))), closed)!.dismissed).toBe(true);
    expect(computeWikiState(stateAt(docWith(para(text("Un tramo distinto [[a")))), closed)!.dismissed).toBe(false);
  });
});
