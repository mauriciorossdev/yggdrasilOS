import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docWriteTool, officeTools, sheetWriteRangeTool } from "./tools.js";

const ctx = { sessionKey: "s", config: {} } as never;

describe("office tools", () => {
  beforeEach(() => {
    process.env.YGGDRASIL_PANE_CONTROL_URL = "http://127.0.0.1:9999";
    process.env.YGGDRASIL_PANE_CONTROL_TOKEN = "tok";
  });
  afterEach(() => {
    delete process.env.YGGDRASIL_PANE_CONTROL_URL;
    delete process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    vi.unstubAllGlobals();
  });

  it("exposes the sheet, document and presentation tools with usable schemas", () => {
    expect(officeTools.map((t) => t.name)).toEqual([
      "sheet_create", "sheet_open", "sheet_read_range", "sheet_write_range",
      "doc_create", "doc_open", "doc_read", "doc_write", "doc_find_replace",
      "deck_create", "deck_open", "deck_read", "deck_write",
    ]);
    for (const t of officeTools) expect(t.parameters.required).toContain("path");
  });

  it("posts the operation to the editor bridge with the token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { written: "A1:B2" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await sheetWriteRangeTool.execute(ctx, { path: "n/a.xlsx", range: "A1", values: [[1, 2], [3, 4]] });
    expect(out).toEqual({ written: "A1:B2" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9999/editors/call");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "sheet",
      op: "write",
      params: { path: "n/a.xlsx", range: "A1", values: [[1, 2], [3, 4]] },
    });
  });

  it("passes the editor's own error message back so the model can fix its call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "editor_error", message: "every row of values must have the same number of columns" }), { status: 422 })));
    await expect(sheetWriteRangeTool.execute(ctx, { path: "a.xlsx", range: "A1", values: [[1], [1, 2]] })).rejects.toThrow(/same number of columns/);
  });

  it("sends document operations to the same bridge as the doc editor", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { blocks: 3, saved: true } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await docWriteTool.execute(ctx, { path: "a.docx", mode: "replace_block", index: 1, markdown: "New" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ kind: "doc", op: "write", params: { path: "a.docx", mode: "replace_block", markdown: "New", index: 1 } });
  });

  it("only offers the write modes the editor understands", () => {
    const mode = (docWriteTool.parameters.properties as Record<string, { enum?: string[] }>).mode;
    expect(mode?.enum).toEqual(["replace", "append", "prepend", "insert_after", "replace_block", "delete_block"]);
  });

  it("explains itself when there is no desktop app behind it", async () => {
    delete process.env.YGGDRASIL_PANE_CONTROL_URL;
    await expect(sheetWriteRangeTool.execute(ctx, { path: "a.xlsx", range: "A1", values: [[1]] })).rejects.toThrow(/only work inside Yggdrasil Desktop/);
  });
});
