import { describe, expect, it } from "vitest";
import { defaultEditorSettings, sanitizeEditorSettings } from "./editorSettings.js";

describe("sanitizeEditorSettings", () => {
  it("falls back to the defaults for missing or malformed input", () => {
    expect(sanitizeEditorSettings(undefined)).toEqual(defaultEditorSettings());
    expect(sanitizeEditorSettings({ fontSize: "big", wordWrap: 1 })).toEqual(defaultEditorSettings());
  });

  it("clamps numbers and keeps valid values", () => {
    expect(sanitizeEditorSettings({ fontSize: 500, tabSize: 0, minimap: true, formatOnSave: true, wordWrap: false })).toEqual({
      fontSize: 32,
      tabSize: 1,
      minimap: true,
      formatOnSave: true,
      wordWrap: false,
      fixOnSave: false,
    });
  });
});
