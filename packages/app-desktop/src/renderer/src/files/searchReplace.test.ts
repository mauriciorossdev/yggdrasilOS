import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { Node } from "@tiptap/pm/model";
import { createSearchPlugin, findInDoc, getSearchState, replaceRanges, searchReplaceKey, stepIndex } from "./searchReplace.js";

const schema = getSchema([StarterKit]);

function docOf(...paragraphs: unknown[][]): Node {
  return Node.fromJSON(schema, {
    type: "doc",
    content: paragraphs.map((content) => ({ type: "paragraph", content })),
  });
}
const text = (t: string, bold = false) => ({ type: "text", text: t, ...(bold ? { marks: [{ type: "bold" }] } : {}) });
const slice = (doc: Node, r: { from: number; to: number }) => doc.textBetween(r.from, r.to);

describe("findInDoc", () => {
  it("finds every occurrence, case-insensitively by default", () => {
    const doc = docOf([text("Flujos y flujos y FLUJOS")], [text("otro flujo")]);
    const found = findInDoc(doc, "flujo");
    expect(found).toHaveLength(4);
    expect(found.map((r) => slice(doc, r))).toEqual(["Flujo", "flujo", "FLUJO", "flujo"]);
  });

  it("honors case sensitivity", () => {
    const doc = docOf([text("Flujos y flujos")]);
    expect(findInDoc(doc, "flujos", true).map((r) => slice(doc, r))).toEqual(["flujos"]);
  });

  it("matches across marks inside one paragraph", () => {
    const doc = docOf([text("Qué ", true), text("leer primero")]);
    const [range] = findInDoc(doc, "qué leer");
    expect(slice(doc, range!)).toBe("Qué leer");
  });

  it("never matches across paragraphs, and gives nothing for an empty query", () => {
    const doc = docOf([text("uno")], [text("dos")]);
    expect(findInDoc(doc, "unodos")).toEqual([]);
    expect(findInDoc(doc, "")).toEqual([]);
  });

  it("gives positions that line up with the document (a hard break takes one position)", () => {
    const doc = docOf([text("antes"), { type: "hardBreak" }, text("después")]);
    const [range] = findInDoc(doc, "después");
    expect(slice(doc, range!)).toBe("después");
  });
});

describe("replaceRanges", () => {
  it("replaces every range, later ones first so positions stay valid, even when the length changes", () => {
    const doc = docOf([text("ab ab ab")]);
    const state = EditorState.create({ doc });
    const tr = replaceRanges(state.tr, findInDoc(doc, "ab"), "xyz");
    expect(tr.doc.textContent).toBe("xyz xyz xyz");
  });

  it("an empty replacement deletes the matches", () => {
    const doc = docOf([text("quitar quitar esto")]);
    const state = EditorState.create({ doc });
    expect(replaceRanges(state.tr, findInDoc(doc, "quitar "), "").doc.textContent).toBe("esto");
  });
});

describe("stepIndex", () => {
  it("wraps around in both directions and copes with no matches", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});

describe("search plugin state", () => {
  const doc = docOf([text("uno dos uno")], [text("tres uno")]);
  const initial = () => EditorState.create({ doc, plugins: [createSearchPlugin()] });

  it("starts empty", () => {
    expect(getSearchState(initial())).toMatchObject({ query: "", matches: [], current: 0 });
  });

  it("collects matches for the query and keeps the current one in range", () => {
    const state = initial().apply(initial().tr.setMeta(searchReplaceKey, { query: "uno", current: 99 }));
    const search = getSearchState(state)!;
    expect(search.matches).toHaveLength(3);
    expect(search.current).toBe(2);
  });

  it("recomputes when the document changes, without being told", () => {
    let state = initial();
    state = state.apply(state.tr.setMeta(searchReplaceKey, { query: "uno" }));
    state = state.apply(replaceRanges(state.tr, [getSearchState(state)!.matches[0]!], "otro"));
    expect(getSearchState(state)!.matches).toHaveLength(2);
  });

  it("clearing the query removes the matches", () => {
    let state = initial();
    state = state.apply(state.tr.setMeta(searchReplaceKey, { query: "uno" }));
    state = state.apply(state.tr.setMeta(searchReplaceKey, { query: "" }));
    expect(getSearchState(state)!.matches).toEqual([]);
  });
});
