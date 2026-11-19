import { afterEach, describe, expect, it } from "vitest";
import { failSheetOpen, getSheetController, registerSheetController, resetSheetRegistryForTest, whenSheetReady, type SheetController } from "./sheetRegistry.js";

const fake = (): SheetController => ({
  info: () => ({ sheets: ["Sheet1"], activeSheet: "Sheet1", usedRange: "A1" }),
  readRange: (range) => ({ range, values: [], formulas: [] }),
  writeRange: async (range) => ({ written: range }),
});

afterEach(resetSheetRegistryForTest);

describe("sheet registry", () => {
  it("returns a registered editor immediately, and forgets it when it unregisters", async () => {
    const c = fake();
    const off = registerSheetController("a.xlsx", c);
    expect(await whenSheetReady("a.xlsx")).toBe(c);
    off();
    expect(getSheetController("a.xlsx")).toBeUndefined();
  });

  it("waits for an editor that is still opening", async () => {
    const pending = whenSheetReady("b.xlsx", 1000);
    const c = fake();
    registerSheetController("b.xlsx", c);
    expect(await pending).toBe(c);
  });

  it("gives up with a clear message when the editor never appears", async () => {
    await expect(whenSheetReady("c.xlsx", 20)).rejects.toThrow(/did not finish opening/);
  });

  it("fails a waiter at once, with the real reason, when the file can't be opened", async () => {
    const pending = whenSheetReady("missing.xlsx", 5000);
    failSheetOpen("missing.xlsx", new Error("ENOENT: no such file"));
    await expect(pending).rejects.toThrow(/ENOENT/);
  });

  it("a stale editor's cleanup doesn't remove a newer one", () => {
    const first = fake();
    const off = registerSheetController("d.xlsx", first);
    const second = fake();
    registerSheetController("d.xlsx", second);
    off();
    expect(getSheetController("d.xlsx")).toBe(second);
  });
});
