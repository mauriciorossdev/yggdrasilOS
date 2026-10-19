import { describe, expect, it } from "vitest";
import { buildFeatureDoc, featureDocPath, parseStatus, parseTasks, slugify } from "./featureDoc.js";

describe("featureDocPath / slugify", () => {
  it("builds a safe path under notes/features", () => {
    expect(featureDocPath("Auditoría de la API — v2!")).toBe("notes/features/auditoria-de-la-api-v2.md");
  });

  it("never lets a title escape the folder", () => {
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(featureDocPath("../")).toBeNull();
    expect(featureDocPath("   ")).toBeNull();
  });
});

describe("buildFeatureDoc", () => {
  it("round-trips through the parsers", () => {
    const doc = buildFeatureDoc("  My feature ");
    expect(doc.startsWith("# My feature\n")).toBe(true);
    expect(parseStatus(doc)).toBe("working");
    expect(parseTasks(doc)).toMatchObject({ done: 0, total: 1 });
  });
});

describe("parseTasks", () => {
  const md = `# F
Status: checking

## Specs
- [x] not a task, this is a spec note

## Tasks
- [x] T1 (S1) done thing — owner: a
- [ ] T2 (S1) open thing
  * [X] T3 nested uppercase
not a checkbox

## Log
- [ ] also not a task`;

  it("counts only checkboxes inside ## Tasks", () => {
    const res = parseTasks(md);
    expect(res.total).toBe(3);
    expect(res.done).toBe(2);
    expect(res.items.map((i) => i.text)).toEqual(["T1 (S1) done thing — owner: a", "T2 (S1) open thing", "T3 nested uppercase"]);
  });

  it("still counts checkboxes whose brackets were escaped by a markdown editor", () => {
    const res = parseTasks("## Tasks\n\n- \\[x\\] T1 done\n- \\[ \\] T2 open\n- ~~T3 dropped~~\n");
    expect(res).toMatchObject({ done: 1, total: 2 });
    expect(res.items[0]!.text).toBe("T1 done");
  });

  it("returns zero when there is no Tasks section", () => {
    expect(parseTasks("# x\n- [ ] a")).toEqual({ done: 0, total: 0, items: [] });
  });

  it("handles CRLF files", () => {
    expect(parseTasks("## Tasks\r\n- [x] a\r\n- [ ] b\r\n").total).toBe(2);
  });
});

describe("parseStatus", () => {
  it("reads a known status, case-insensitively", () => {
    expect(parseStatus("# t\nStatus: Ready\n")).toBe("ready");
    expect(parseStatus("Status: needs-decision")).toBe("needs-decision");
  });

  it("returns null for unknown or missing status", () => {
    expect(parseStatus("Status: banana")).toBeNull();
    expect(parseStatus("# no status")).toBeNull();
  });
});
