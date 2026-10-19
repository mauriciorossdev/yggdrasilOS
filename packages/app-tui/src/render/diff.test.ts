import { describe, it, expect } from "vitest";
import { isUnifiedDiff, parseDiff } from "./diff.js";

const sampleDiff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;`;

describe("isUnifiedDiff", () => {
  it("detects unified diff format", () => {
    expect(isUnifiedDiff(sampleDiff)).toBe(true);
  });

  it("rejects plain text", () => {
    expect(isUnifiedDiff("hello world\nfoo bar")).toBe(false);
  });

  it("rejects text with only +/- lines but no headers", () => {
    expect(isUnifiedDiff("+added\n-removed")).toBe(false);
  });
});

describe("parseDiff", () => {
  it("classifies lines correctly", () => {
    const lines = parseDiff(sampleDiff);
    expect(lines[0]).toEqual({ text: "--- a/file.ts", kind: "meta" });
    expect(lines[1]).toEqual({ text: "+++ b/file.ts", kind: "meta" });
    expect(lines[2]).toEqual({ text: "@@ -1,3 +1,4 @@", kind: "hunk" });
    expect(lines[3]).toEqual({ text: " const a = 1;", kind: "ctx" });
    expect(lines[4]).toEqual({ text: "-const b = 2;", kind: "del" });
    expect(lines[5]).toEqual({ text: "+const b = 3;", kind: "add" });
    expect(lines[6]).toEqual({ text: "+const c = 4;", kind: "add" });
    expect(lines[7]).toEqual({ text: " const d = 5;", kind: "ctx" });
  });
});
