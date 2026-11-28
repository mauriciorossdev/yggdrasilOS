import { describe, expect, it, vi } from "vitest";
import { contentToSave, registerEditorBridge, releaseModel } from "./editorBridge.js";

describe("editor bridge", () => {
  it("saves content untouched and releases nothing before the editor has loaded", async () => {
    await expect(contentToSave("a.ts", "x")).resolves.toBe("x");
    expect(() => releaseModel("a.ts")).not.toThrow();
  });

  it("delegates to the editor once it registers", async () => {
    const bridge = { releaseModel: vi.fn(), contentToSave: vi.fn(async (_path: string, content: string) => `${content};`) };
    registerEditorBridge(bridge);
    await expect(contentToSave("a.ts", "x")).resolves.toBe("x;");
    releaseModel("a.ts");
    expect(bridge.releaseModel).toHaveBeenCalledWith("a.ts");
  });
});
