import { describe, expect, it } from "vitest";
import { closeTab, openTab, workspaceKindFor, type WorkspaceState } from "./workspaceStore.js";

const empty: WorkspaceState = { tabs: [], activeId: null };

describe("workspace tabs", () => {
  it("opens a tab and makes it active", () => {
    const s = openTab(empty, "sheet", "notes/a.xlsx");
    expect(s.tabs).toEqual([{ id: "sheet:notes/a.xlsx", kind: "sheet", path: "notes/a.xlsx" }]);
    expect(s.activeId).toBe("sheet:notes/a.xlsx");
  });

  it("opening a file that is already open only activates it", () => {
    const two = openTab(openTab(empty, "sheet", "a.xlsx"), "sheet", "b.xlsx");
    const again = openTab(two, "sheet", "a.xlsx");
    expect(again.tabs).toHaveLength(2);
    expect(again.activeId).toBe("sheet:a.xlsx");
  });

  it("closing the active tab activates its neighbour, the last one empties the container", () => {
    const s = openTab(openTab(openTab(empty, "sheet", "a.xlsx"), "sheet", "b.xlsx"), "sheet", "c.xlsx");
    expect(closeTab({ ...s, activeId: "sheet:b.xlsx" }, "sheet:b.xlsx").activeId).toBe("sheet:c.xlsx");
    expect(closeTab(s, "sheet:c.xlsx").activeId).toBe("sheet:b.xlsx");
    expect(closeTab(openTab(empty, "sheet", "a.xlsx"), "sheet:a.xlsx")).toEqual(empty);
  });

  it("closing a tab that is not active keeps the active one", () => {
    const s = openTab(openTab(empty, "sheet", "a.xlsx"), "sheet", "b.xlsx");
    expect(closeTab(s, "sheet:a.xlsx").activeId).toBe("sheet:b.xlsx");
  });

  it("spreadsheets, Word documents and presentations have a workspace editor", () => {
    expect(workspaceKindFor("notes/Budget.XLSX")).toBe("sheet");
    expect(workspaceKindFor("notes/a.docx")).toBe("doc");
    expect(workspaceKindFor("notes/a.pptx")).toBe("deck");
    expect(workspaceKindFor("a.md")).toBeNull();
    expect(workspaceKindFor("notes/a.ppt")).toBeNull();
  });
});
