import { describe, expect, it } from "vitest";
import { derivePaneSpecBadge, docChipText } from "./paneSpecBadge.js";

describe("derivePaneSpecBadge", () => {
  it("uses the explicit Status line when present", () => {
    const md = "# F\nStatus: checking\n\n## Tasks\n- [x] a\n- [x] b\n";
    expect(derivePaneSpecBadge(md)).toEqual({ status: "checking", labelKey: "term.spec.checking", done: 2, total: 2 });
    expect(derivePaneSpecBadge("Status: needs-decision\n").labelKey).toBe("term.spec.needsDecision");
  });

  it("derives Ready when every task is ticked and there is no Status", () => {
    expect(derivePaneSpecBadge("## Tasks\n- [x] a\n- [X] b\n")).toMatchObject({ status: "ready", done: 2, total: 2 });
  });

  it("derives Working for open tasks, an empty list, or an unknown Status", () => {
    expect(derivePaneSpecBadge("## Tasks\n- [x] a\n- [ ] b\n")).toMatchObject({ status: "working", done: 1, total: 2 });
    expect(derivePaneSpecBadge("# no tasks")).toMatchObject({ status: "working", done: 0, total: 0 });
    expect(derivePaneSpecBadge("Status: banana\n## Tasks\n- [ ] a\n").status).toBe("working");
  });
});

describe("docChipText", () => {
  const badge = (md: string) => derivePaneSpecBadge(md);

  it("shows only the progress while the doc is still working", () => {
    expect(docChipText(badge("## Tasks\n- [x] a\n- [ ] b\n- [ ] c\n"))).toEqual({ showStatus: false, progress: "1/3" });
    expect(docChipText(badge("# no tasks"))).toEqual({ showStatus: false, progress: null });
  });

  it("names any other status, with the count except for a decision", () => {
    expect(docChipText(badge("## Tasks\n- [x] a\n- [x] b\n"))).toEqual({ showStatus: true, progress: "2/2" });
    expect(docChipText(badge("Status: checking\n## Tasks\n- [x] a\n- [ ] b\n"))).toEqual({ showStatus: true, progress: "1/2" });
    expect(docChipText(badge("Status: needs-decision\n## Tasks\n- [ ] a\n"))).toEqual({ showStatus: true, progress: null });
  });
});
