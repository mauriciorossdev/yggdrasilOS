import { describe, expect, it } from "vitest";
import { lineDiff, withContext } from "./lineDiff.js";

describe("lineDiff", () => {
  it("marks added, removed and kept lines with their numbers", () => {
    expect(lineDiff("a\nb\nc\n", "a\nx\nc\nd\n")).toEqual([
      { kind: "same", text: "a", oldNo: 1, newNo: 1 },
      { kind: "del", text: "b", oldNo: 2 },
      { kind: "add", text: "x", newNo: 2 },
      { kind: "same", text: "c", oldNo: 3, newNo: 3 },
      { kind: "add", text: "d", newNo: 4 },
    ]);
  });

  it("handles a new file and a deleted one", () => {
    expect(lineDiff("", "x\ny")!.map((l) => l.kind)).toEqual(["add", "add"]);
    expect(lineDiff("x", "")!.map((l) => l.kind)).toEqual(["del"]);
  });

  it("gives up on huge inputs instead of freezing the page", () => {
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
    expect(lineDiff(big, big + "\nmore")).toBeNull();
  });
});

describe("withContext", () => {
  it("folds long unchanged runs into one gap", () => {
    const lines = lineDiff("1\n2\n3\n4\n5\n6\n7\n8\n9\n", "1\n2\n3\n4\nX\n6\n7\n8\n9\n")!;
    const shown = withContext(lines, 1);
    expect(shown[0]).toEqual({ kind: "gap", count: 3 });
    expect(shown.filter((l) => l.kind !== "gap").map((l) => (l as { text: string }).text)).toEqual(["4", "5", "X", "6"]);
    expect(shown.at(-1)).toEqual({ kind: "gap", count: 3 });
  });
});
