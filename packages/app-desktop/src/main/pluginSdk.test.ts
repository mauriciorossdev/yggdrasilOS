import { describe, expect, it } from "vitest";
import { PLUGIN_SDK_SOURCE } from "./pluginSdk.js";

describe("plugin SDK", () => {
  it("the source served to plugins parses", () => {
    expect(() => new Function(PLUGIN_SDK_SOURCE)).not.toThrow();
  });
});
