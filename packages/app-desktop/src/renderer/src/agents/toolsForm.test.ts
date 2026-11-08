import { describe, expect, it } from "vitest";
import { EMPTY_TOOLS_FORM, parseToolsAllow, toolsPayload, toolsToForm } from "./toolsForm.js";

describe("toolsForm", () => {
  it("reads an agent without tools.allow as unrestricted", () => {
    expect(toolsToForm(undefined)).toEqual(EMPTY_TOOLS_FORM);
    expect(toolsToForm({})).toEqual(EMPTY_TOOLS_FORM);
  });

  it("reads tools.allow as a restriction, including the empty list", () => {
    expect(toolsToForm({ allow: ["fs_read_*", "web_fetch"] })).toEqual({ toolsRestricted: true, toolsAllow: "fs_read_*, web_fetch" });
    expect(toolsToForm({ allow: [] })).toEqual({ toolsRestricted: true, toolsAllow: "" });
  });

  it("parses the comma-separated text", () => {
    expect(parseToolsAllow(" fs_read_* ,, web_fetch ,")).toEqual(["fs_read_*", "web_fetch"]);
  });

  it("sends tools.allow when restricted, even if the list is empty (no tools)", () => {
    expect(toolsPayload({ toolsRestricted: true, toolsAllow: "a, b" }, false)).toEqual({ tools: { allow: ["a", "b"] } });
    expect(toolsPayload({ toolsRestricted: true, toolsAllow: "" }, true)).toEqual({ tools: { allow: [] } });
  });

  it("clears the restriction on update but omits tools on create", () => {
    expect(toolsPayload(EMPTY_TOOLS_FORM, true)).toEqual({ tools: {} });
    expect(toolsPayload(EMPTY_TOOLS_FORM, false)).toEqual({});
  });
});
