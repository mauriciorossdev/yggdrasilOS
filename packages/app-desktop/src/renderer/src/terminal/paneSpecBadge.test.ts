import { describe, expect, it } from "vitest";
import { derivePaneSpecBadge } from "./paneSpecBadge.js";

describe("derivePaneSpecBadge", () => {
  it("uses the explicit Status line when present", () => {
    const md = "# F\nStatus: checking\n\n## Tasks\n- [x] a\n- [x] b\n";
    expect(derivePaneSpecBadge(md)).toEqual({ status: "checking", label: "Checking", done: 2, total: 2 });
    expect(derivePaneSpecBadge("Status: needs-decision\n").label).toBe("Needs your decision");
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
