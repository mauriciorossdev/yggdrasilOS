import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { xlsxToSnapshot, type DocModel } from "@yggdrasil/tool-office";
import { copyPathFor, createDeckFile, createDocFile, createSheetFile, loadDeck, loadDoc, saveDeck, loadSheetSnapshot, saveDoc, saveSheetSnapshot, setSheetBaseline } from "./officeFiles.js";

const dir = () => mkdtemp(join(tmpdir(), "office-files-"));

describe("officeFiles", () => {
  it("creates a workbook, loads it back, and saves edits atomically", async () => {
    const root = await dir();
    const path = join(root, "notes", "data.xlsx");
    await createSheetFile(path, [["name", "qty"], ["apples", 3], ["total", "=B2"]]);
    const { snapshot: snap, lossy } = await loadSheetSnapshot(path, "data.xlsx");
    expect(lossy).toEqual([]);
    const sheet = snap.sheets[snap.sheetOrder[0]!]!;
    expect(sheet.cellData[1]![1]).toMatchObject({ v: 3 });
    expect(sheet.cellData[2]![1]).toMatchObject({ f: "=B2" });

    sheet.cellData[1]![1] = { v: 9, t: 2 };
    await saveSheetSnapshot(path, snap);
    const { snapshot: again } = await loadSheetSnapshot(path, "data.xlsx");
    expect(again.sheets[again.sheetOrder[0]!]!.cellData[1]![1]).toMatchObject({ v: 9 });
  });

  it("never overwrites an existing file when creating", async () => {
    const path = join(await dir(), "a.xlsx");
    await createSheetFile(path, [["x"]]);
    await expect(createSheetFile(path, [["y"]])).rejects.toThrow(/ya existe/);
  });

  it("only handles .xlsx", async () => {
    const root = await dir();
    await writeFile(join(root, "a.csv"), "x");
    await expect(loadSheetSnapshot(join(root, "a.csv"), "a")).rejects.toThrow(/\.xlsx/);
    await expect(createSheetFile(join(root, "b.docx"))).rejects.toThrow(/\.xlsx/);
  });

  it("leaves no temporary file behind after saving", async () => {
    const path = join(await dir(), "t.xlsx");
    await createSheetFile(path);
    await expect(readFile(`${path}.saving`)).rejects.toThrow();
  });

  it("reports only what even a patching save can't keep", async () => {
    const path = join(await dir(), "styled.xlsx");
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("S").getCell("A1").border = { top: { style: "thin" } };
    await wb.xlsx.writeFile(path);
    expect((await loadSheetSnapshot(path, "styled.xlsx")).lossy).toEqual([]);
  });

  it("saves by patching the original, so what the editor can't model survives an edit", async () => {
    const path = join(await dir(), "rich.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.getCell("A1").value = "edit me";
    ws.getCell("A2").value = { text: "link", hyperlink: "https://example.com" };
    ws.getCell("A3").dataValidation = { type: "whole", operator: "between", formulae: [1, 9] };
    ws.getCell("A4").value = "noted";
    ws.getCell("A4").note = "a comment";
    ws.addConditionalFormatting({ ref: "A1", rules: [{ type: "cellIs", operator: "equal", formulae: ["\"x\""], priority: 1, style: { font: { bold: true } } }] });
    await wb.xlsx.writeFile(path);

    const { snapshot } = await loadSheetSnapshot(path, "rich.xlsx");
    snapshot.sheets[snapshot.sheetOrder[0]!]!.cellData[0]![0] = { v: "edited", t: 1 };
    await saveSheetSnapshot(path, snapshot);

    const out = new ExcelJS.Workbook();
    await out.xlsx.readFile(path);
    const sheet = out.worksheets[0]!;
    expect(sheet.getCell("A1").value).toBe("edited");
    expect(sheet.getCell("A2").value).toMatchObject({ hyperlink: "https://example.com" });
    expect(sheet.getCell("A3").dataValidation?.type).toBe("whole");
    expect(sheet.getCell("A4").note).toBeTruthy();
    expect(((sheet.model as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings ?? []).length).toBe(1);
  });

  it("diffs against the editor's own baseline, not the converter's", async () => {
    const path = join(await dir(), "base.xlsx");
    await createSheetFile(path, [["a", "b"]]);
    const { snapshot } = await loadSheetSnapshot(path, "base.xlsx");
    // The editor normalizes the snapshot it opens (here: it gives every cell an explicit style) and reports that as the baseline.
    const normalized = JSON.parse(JSON.stringify(snapshot));
    normalized.styles.s9 = { fs: 11 };
    for (const cell of Object.values(normalized.sheets[normalized.sheetOrder[0]].cellData[0])) (cell as { s?: string }).s = "s9";
    setSheetBaseline(path, normalized);
    const unchanged = JSON.parse(JSON.stringify(normalized));
    const before = await readFile(path);
    await saveSheetSnapshot(path, unchanged);
    const after = await xlsxToSnapshot(await readFile(path));
    expect(after.sheets[after.sheetOrder[0]!]!.cellData[0]![0]).toMatchObject({ v: "a" });
    expect(after.styles[after.sheets[after.sheetOrder[0]!]!.cellData[0]![0]!.s as string]).toBeUndefined(); // no style was injected
    expect((await readFile(path)).length).toBeGreaterThan(0);
    expect(before.length).toBeGreaterThan(0);
  });

  it("picks a copy name that never overwrites anything", async () => {
    const root = await dir();
    const path = join(root, "plan.xlsx");
    expect(await copyPathFor(path)).toBe(join(root, "plan (copia).xlsx"));
    await createSheetFile(join(root, "plan (copia).xlsx"));
    expect(await copyPathFor(path)).toBe(join(root, "plan (copia 2).xlsx"));
  });
});

describe("Word documents", () => {
  const model = { blocks: [{ type: "heading" as const, level: 1 as const, runs: [{ text: "Title" }] }, { type: "paragraph" as const, runs: [{ text: "Body", bold: true }] }] };

  it("creates, loads back and saves a document atomically", async () => {
    const path = join(await dir(), "notes", "memo.docx");
    await createDocFile(path, model);
    const loaded = await loadDoc(path);
    expect(loaded.model).toEqual(model);
    expect(loaded.lossy).toEqual([]);
    await saveDoc(path, { blocks: [{ type: "paragraph", runs: [{ text: "Changed" }] }] });
    expect((await loadDoc(path)).model.blocks).toEqual([{ type: "paragraph", runs: [{ text: "Changed" }] }]);
    await expect(readFile(`${path}.saving`)).rejects.toThrow();
  });

  it("never overwrites on create, and only handles .docx", async () => {
    const root = await dir();
    await createDocFile(join(root, "a.docx"), model);
    await expect(createDocFile(join(root, "a.docx"), model)).rejects.toThrow(/ya existe/);
    await expect(createDocFile(join(root, "a.xlsx"), model)).rejects.toThrow(/\.docx/);
    await writeFile(join(root, "a.txt"), "x");
    await expect(loadDoc(join(root, "a.txt"))).rejects.toThrow(/\.docx/);
  });
});


describe("PowerPoint presentations", () => {
  const deck = { theme: "light" as const, slides: [{ layout: "title" as const, title: [{ text: "Hello" }], body: [] }, { layout: "content" as const, title: [{ text: "Two" }], body: [{ type: "paragraph" as const, runs: [{ text: "Body" }] }] }] };

  it("creates, loads back and saves a deck atomically", async () => {
    const path = join(await dir(), "notes", "pitch.pptx");
    await createDeckFile(path, deck);
    const loaded = await loadDeck(path);
    expect(loaded.deck).toEqual(deck);
    expect(loaded.lossy).toEqual([]);
    await saveDeck(path, { ...deck, slides: deck.slides.slice(0, 1) });
    expect((await loadDeck(path)).deck.slides).toHaveLength(1);
    await expect(readFile(`${path}.saving`)).rejects.toThrow();
  });

  it("never overwrites on create, and only handles .pptx", async () => {
    const root = await dir();
    await createDeckFile(join(root, "a.pptx"), deck);
    await expect(createDeckFile(join(root, "a.pptx"), deck)).rejects.toThrow(/ya existe/);
    await expect(createDeckFile(join(root, "a.docx"), deck)).rejects.toThrow(/\.pptx/);
  });

  it("serializes overlapping saves of the same file", async () => {
    const root = await dir();
    const path = join(root, "a.docx");
    const doc = (text: string): DocModel => ({ blocks: [{ type: "paragraph", runs: [{ text }] }] });
    await createDocFile(path, doc("start"));
    // Fired without awaiting in between, like the editors' debounce plus the save on close.
    await Promise.all(Array.from({ length: 8 }, (_, i) => saveDoc(path, doc(`v${i}`))));
    const { model } = await loadDoc(path);
    expect(JSON.stringify(model)).toContain("v7");
    expect((await readdir(root)).filter((f) => f.endsWith(".saving"))).toEqual([]);
  });

  it("a load waits for an earlier save of the same file", async () => {
    const path = join(await dir(), "a.xlsx");
    await createSheetFile(path, [["x"]]);
    const { snapshot } = await loadSheetSnapshot(path, "a.xlsx");
    snapshot.sheets[snapshot.sheetOrder[0]!]!.cellData[0]![0] = { v: "changed", t: 1 };
    const saving = saveSheetSnapshot(path, snapshot);
    const reloaded = await loadSheetSnapshot(path, "a.xlsx");
    await saving;
    expect(reloaded.snapshot.sheets[reloaded.snapshot.sheetOrder[0]!]!.cellData[0]![0]).toMatchObject({ v: "changed" });
  });
});
