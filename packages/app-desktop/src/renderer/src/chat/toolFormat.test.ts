import { describe, expect, it } from "vitest";
import { formatToolResult, openableFilePath, summarizeArgs, toProjectRelative } from "./toolFormat.js";

describe("summarizeArgs", () => {
  it("prefers the command", () => {
    expect(summarizeArgs({ command: "open https://www.google.com" })).toBe("open https://www.google.com");
  });
  it("falls back to compact pairs", () => {
    expect(summarizeArgs({ a: 1, b: "x" })).toBe("a: 1 · b: x");
  });
});

describe("formatToolResult", () => {
  it("hides an empty successful shell result", () => {
    const raw = '{"command":"open x","stdout":"","stdoutTruncated":false,"stderr":"","stderrTruncated":false,"exitCode":0}';
    expect(formatToolResult(raw)).toEqual({ body: "", note: undefined });
  });
  it("shows stdout and a failing exit code", () => {
    expect(formatToolResult('{"stdout":"hi\\n","stderr":"boom","exitCode":2}')).toEqual({ body: "hi\nboom", note: "exit 2" });
  });
  it("keeps plain text and pretty-prints other JSON", () => {
    expect(formatToolResult("hello")).toEqual({ body: "hello" });
    expect(formatToolResult('{"a":1}').body).toBe('{\n  "a": 1\n}');
  });
});

describe("openableFilePath", () => {
  it("converts absolute paths under the project and keeps relative ones", () => {
    expect(toProjectRelative("/p/proj/src/a.ts", "/p/proj")).toBe("src/a.ts");
    expect(toProjectRelative("./src/a.ts", "/p/proj")).toBe("src/a.ts");
  });
  it("refuses paths outside the project", () => {
    expect(toProjectRelative("/etc/hosts", "/p/proj")).toBeNull();
    expect(toProjectRelative("../x", "/p/proj")).toBeNull();
    expect(toProjectRelative("/p/proj-other/a", "/p/proj")).toBeNull();
  });
  it("reads the path argument of a tool call", () => {
    expect(openableFilePath({ path: "src/a.ts" }, "/p/proj")).toBe("src/a.ts");
    expect(openableFilePath({ command: "ls" }, "/p/proj")).toBeNull();
  });
});
