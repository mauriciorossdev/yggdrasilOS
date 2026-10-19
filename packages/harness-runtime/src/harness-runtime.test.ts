import { describe, it, expect, beforeEach } from "vitest";
import { getHarness, resetRegistryForTest } from "@yggdrasil/kernel";
import { registerBuiltinHarnesses } from "./builtin/echo.js";

describe("harness-runtime builtin", () => {
  beforeEach(() => {
    resetRegistryForTest();
  });

  it("registers builtin echo harness", () => {
    registerBuiltinHarnesses();
    expect(getHarness("builtin-echo")).toBeDefined();
  });
});
