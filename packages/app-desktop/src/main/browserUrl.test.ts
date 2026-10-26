import { describe, expect, it } from "vitest";
import { normalizeBrowserUrl, resolveBrowserInput } from "./browserUrl.js";

describe("normalizeBrowserUrl", () => {
  it("defaults a bare host to https", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
  });

  it("rejects non-http schemes", () => {
    expect(() => normalizeBrowserUrl("file:///etc/passwd")).toThrow(/unsupported URL scheme/);
    expect(() => normalizeBrowserUrl("javascript:alert(1)")).toThrow(/unsupported URL scheme/);
  });

  it("requires a value", () => {
    expect(() => normalizeBrowserUrl("  ")).toThrow(/required/);
  });
});

describe("resolveBrowserInput", () => {
  it("keeps explicit http(s) URLs", () => {
    expect(resolveBrowserInput("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(resolveBrowserInput("http://example.com")).toBe("http://example.com/");
  });

  it("treats dotted names as hosts, defaulting to https", () => {
    expect(resolveBrowserInput("example.com")).toBe("https://example.com/");
    expect(resolveBrowserInput("docs.foo.dev/guide?x=1")).toBe("https://docs.foo.dev/guide?x=1");
  });

  it("defaults localhost and LAN hosts to http, with or without a port", () => {
    expect(resolveBrowserInput("localhost")).toBe("http://localhost/");
    expect(resolveBrowserInput("localhost:3000")).toBe("http://localhost:3000/");
    expect(resolveBrowserInput("127.0.0.1:5173/app")).toBe("http://127.0.0.1:5173/app");
    expect(resolveBrowserInput("192.168.1.20:8080")).toBe("http://192.168.1.20:8080/");
  });

  it("treats a bare host:port as a host", () => {
    expect(resolveBrowserInput("myhost:8080")).toBe("https://myhost:8080/");
  });

  it("searches for anything that is not a URL or host", () => {
    expect(resolveBrowserInput("gatos")).toBe("https://duckduckgo.com/?q=gatos");
    expect(resolveBrowserInput("how to center a div")).toBe("https://duckduckgo.com/?q=how%20to%20center%20a%20div");
    expect(resolveBrowserInput("what is example.com?")).toBe(
      "https://duckduckgo.com/?q=what%20is%20example.com%3F",
    );
  });

  it("never turns an unsafe scheme into a search or a navigation", () => {
    expect(() => resolveBrowserInput("javascript:alert(1)")).toThrow(/unsupported URL scheme/);
    expect(() => resolveBrowserInput("file:///C:/secret.txt")).toThrow(/unsupported URL scheme/);
    expect(() => resolveBrowserInput("data:text/html,<h1>x</h1>")).toThrow(/unsupported URL scheme/);
  });

  it("requires a value", () => {
    expect(() => resolveBrowserInput("")).toThrow(/required/);
  });
});
