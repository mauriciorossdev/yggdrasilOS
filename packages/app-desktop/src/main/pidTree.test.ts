import { describe, expect, it } from "vitest";
import { parsePidTable } from "./pidTree.js";

describe("parsePidTable", () => {
  it("reads pid,ppid lines (with CRLF and spaces) and skips the rest", () => {
    const out = "ProcessId,ParentProcessId\r\n4,0\r\n 1200 , 4 \r\n3456,1200\r\nnot a line\r\n0,0\r\n";
    expect([...parsePidTable(out)]).toEqual([
      [4, 0],
      [1200, 4],
      [3456, 1200],
    ]);
  });
  it("is empty for no usable output", () => {
    expect(parsePidTable("").size).toBe(0);
    expect(parsePidTable("error: access denied").size).toBe(0);
  });
});
