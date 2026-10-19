import { describe, it, expect } from "vitest";
import { parsePluginManifest } from "@yggdrasil/sdk";

describe("sdk manifest", () => {
  it("parses a valid manifest", () => {
    const manifest = parsePluginManifest({
      id: "tui",
      entry: "./index.ts",
      kind: ["channel"],
      channels: [{ id: "tui", label: "Terminal" }],
    });
    expect(manifest.id).toBe("tui");
    expect(manifest.entry).toBe("./index.ts");
    expect(manifest.channels?.[0]?.label).toBe("Terminal");
  });

  it("rejects invalid manifest", () => {
    expect(() => parsePluginManifest({})).toThrow();
  });
});
