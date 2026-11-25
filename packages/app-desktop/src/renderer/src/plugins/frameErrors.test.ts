import { describe, expect, it } from "vitest";
import { errorCore, isFrameOf, relativeSource, tidyStack } from "./frameErrors.js";

const base = "ygg-plugin://plugin/project/p1/tasks/";

describe("isFrameOf", () => {
  it("matches this iframe's own ygg-frame id", () => {
    expect(isFrameOf(`${base}?v=1&ygg-frame=abc`, base, "abc")).toBe(true);
  });

  it("rejects another iframe showing the same plugin", () => {
    expect(isFrameOf(`${base}?v=1&ygg-frame=other`, base, "abc")).toBe(false);
  });

  it("accepts a page of the same plugin that dropped the param after navigating", () => {
    expect(isFrameOf(`${base}settings.html`, base, "abc")).toBe(true);
  });

  it("rejects a different plugin, even one whose id starts the same", () => {
    expect(isFrameOf("ygg-plugin://plugin/project/p1/tasks-2/?ygg-frame=abc", base, "abc")).toBe(false);
    expect(isFrameOf("ygg-plugin://plugin/project/p1/notes/?ygg-frame=abc", base, "abc")).toBe(false);
  });

  it("rejects everything when the plugin has no URL (broken manifest)", () => {
    expect(isFrameOf(`${base}?ygg-frame=abc`, "", "abc")).toBe(false);
  });
});

describe("errorCore", () => {
  it("strips Chromium's uncaught prefixes", () => {
    expect(errorCore("Uncaught Error: boom")).toBe("Error: boom");
    expect(errorCore("Uncaught (in promise) Error: boom")).toBe("Error: boom");
    expect(errorCore("Error: boom")).toBe("Error: boom");
  });

  it("is contained in the SDK's own report of the same error", () => {
    expect("Uncaught Error: boom").toContain(errorCore("Uncaught Error: boom"));
    expect("Unhandled promise rejection: Error: boom").toContain(errorCore("Uncaught (in promise) Error: boom"));
  });
});

describe("relativeSource", () => {
  it("shows plugin files relative to the plugin", () => {
    expect(relativeSource(`${base}app.js`, base)).toBe("app.js");
  });

  it("leaves other scripts untouched", () => {
    expect(relativeSource("ygg-plugin://sdk/ygg.js", base)).toBe("ygg-plugin://sdk/ygg.js");
  });
});

describe("tidyStack", () => {
  it("turns the plugin's URLs into relative paths, the bare base into its entry", () => {
    const stack = `Error: boom\n    at ${base}?v=0&ygg-frame=abc:12:44\n    at ${base}app.js:3:1`;
    expect(tidyStack(stack, base)).toBe("Error: boom\n    at index.html:12:44\n    at app.js:3:1");
  });

  it("leaves other URLs alone", () => {
    expect(tidyStack("at ygg-plugin://sdk/ygg.js:5:2", base)).toBe("at ygg-plugin://sdk/ygg.js:5:2");
  });
});
