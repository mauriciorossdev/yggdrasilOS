import { describe, expect, it } from "vitest";
import { saveStatus, shouldAutosave, type AutosaveTab } from "./autosave.js";

const tab = (over: Partial<AutosaveTab & { saveError?: string }> = {}): AutosaveTab & { saveError?: string } => ({
  content: "nuevo",
  savedContent: "viejo",
  loading: false,
  error: null,
  truncated: false,
  ...over,
});

describe("shouldAutosave", () => {
  it("writes a note with unsaved edits", () => {
    expect(shouldAutosave(tab())).toBe(true);
  });

  it("does nothing when there is nothing new, or no tab", () => {
    expect(shouldAutosave(tab({ content: "igual", savedContent: "igual" }))).toBe(false);
    expect(shouldAutosave(undefined)).toBe(false);
  });

  it("never writes a partly loaded, still loading or errored file", () => {
    expect(shouldAutosave(tab({ truncated: true }))).toBe(false);
    expect(shouldAutosave(tab({ loading: true }))).toBe(false);
    expect(shouldAutosave(tab({ error: "no se pudo leer" }))).toBe(false);
  });

  it("waits for the user to pick a side when the file changed on disk, and while a save is running", () => {
    expect(shouldAutosave(tab({ diskConflict: "otra versión" }))).toBe(false);
    expect(shouldAutosave(tab({ saveState: "saving" }))).toBe(false);
  });
});

describe("saveStatus", () => {
  it("says saved when clean and unsaved when dirty", () => {
    expect(saveStatus(tab({ content: "a", savedContent: "a" }))).toEqual({ tone: "saved", message: { key: "docs.save.saved" } });
    expect(saveStatus(tab())).toEqual({ tone: "dirty", message: { key: "docs.save.dirty" } });
  });

  it("shows the save in progress and its failure with the reason", () => {
    expect(saveStatus(tab({ saveState: "saving" }))).toEqual({ tone: "saving", message: { key: "docs.save.saving" } });
    expect(saveStatus(tab({ saveState: "error", saveError: "disco lleno" }))).toEqual({
      tone: "error",
      message: { key: "docs.save.failedWith", vars: { reason: "disco lleno" } },
    });
  });

  it("a failed save that was since undone is just clean again", () => {
    expect(saveStatus(tab({ content: "a", savedContent: "a", saveState: "error" })).tone).toBe("saved");
  });

  it("explains why it isn't saving: truncated file, conflict with disk", () => {
    expect(saveStatus(tab({ truncated: true })).tone).toBe("blocked");
    expect(saveStatus(tab({ diskConflict: "x" })).message).toEqual({ key: "docs.save.conflict" });
  });
});
