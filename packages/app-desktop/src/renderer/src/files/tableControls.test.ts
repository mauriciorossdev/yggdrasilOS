import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/react";
import { TABLE_ACTIONS, TABLE_MARKDOWN, insertTable } from "./tableControls.js";

/** A stand-in for TipTap's editor that records the chain methods called and answers `can()` from a set. */
function fakeEditor(cannot: string[] = []) {
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["focus", "addRowBefore", "addRowAfter", "addColumnBefore", "addColumnAfter", "deleteRow", "deleteColumn", "toggleHeaderRow", "deleteTable", "insertTable"]) {
    chain[m] = (arg?: unknown) => {
      calls.push(arg === undefined ? m : `${m}(${JSON.stringify(arg)})`);
      return chain;
    };
  }
  chain.run = () => true;
  const can: Record<string, () => boolean> = {};
  for (const m of ["addRowBefore", "addRowAfter", "addColumnBefore", "addColumnAfter", "deleteRow", "deleteColumn", "toggleHeaderRow", "deleteTable"]) can[m] = () => !cannot.includes(m);
  return { editor: { chain: () => chain, can: () => can } as unknown as Editor, calls };
}

describe("TABLE_ACTIONS", () => {
  const expected: Record<string, string> = {
    rowBefore: "addRowBefore",
    rowAfter: "addRowAfter",
    colBefore: "addColumnBefore",
    colAfter: "addColumnAfter",
    deleteRow: "deleteRow",
    deleteCol: "deleteColumn",
    header: "toggleHeaderRow",
    deleteTable: "deleteTable",
  };

  it("has an action for each thing a table needs, each with a label and a title", () => {
    expect(TABLE_ACTIONS.map((a) => a.id)).toEqual(Object.keys(expected));
    for (const a of TABLE_ACTIONS) {
      expect(a.label).not.toBe("");
      expect(a.title).not.toBe("");
    }
  });

  for (const action of TABLE_ACTIONS) {
    it(`${action.id} focuses the editor and runs ${expected[action.id]}`, () => {
      const { editor, calls } = fakeEditor();
      action.run(editor);
      expect(calls).toEqual(["focus", expected[action.id]]);
    });
  }

  it("asks the editor whether each action is possible", () => {
    const { editor } = fakeEditor(["deleteRow"]);
    expect(TABLE_ACTIONS.find((a) => a.id === "deleteRow")!.can(editor)).toBe(false);
    expect(TABLE_ACTIONS.find((a) => a.id === "rowAfter")!.can(editor)).toBe(true);
  });
});

describe("insertTable", () => {
  it("inserts a 3x3 table with a header row", () => {
    const { editor, calls } = fakeEditor();
    insertTable(editor);
    expect(calls).toEqual(["focus", 'insertTable({"rows":3,"cols":3,"withHeaderRow":true})']);
  });
});

describe("TABLE_MARKDOWN", () => {
  it("is a header, a separator and an empty row, set apart by blank lines", () => {
    const lines = TABLE_MARKDOWN.split("\n");
    expect(lines.filter((l) => l.startsWith("|"))).toHaveLength(3);
    expect(lines[0]).toBe("");
  });
});
