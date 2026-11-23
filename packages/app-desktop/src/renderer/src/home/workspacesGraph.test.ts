import { describe, expect, it } from "vitest";
import { borderPoint, projectsInZone, rectFromDrag, defaultPosition, isTrusted, pairAudit, pairHasTrust, pairKey, pairsFromLinks } from "./workspacesGraph.js";

describe("pairsFromLinks", () => {
  it("merges both directions into one pair and flags one-way links", () => {
    const pairs = pairsFromLinks({ lib: ["app", "docs"], app: ["lib"], zed: ["docs"] });
    expect(pairs).toEqual(
      expect.arrayContaining([
        { key: "app|lib", a: "app", b: "lib", ab: true, ba: true },
        { key: "docs|lib", a: "docs", b: "lib", ab: false, ba: true },
        { key: "docs|zed", a: "docs", b: "zed", ab: false, ba: true },
      ]),
    );
    expect(pairs).toHaveLength(3);
  });

  it("ignores self-links", () => {
    expect(pairsFromLinks({ a: ["a"] })).toEqual([]);
  });

  it("uses an order-independent key", () => {
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
  });
});

describe("trust helpers", () => {
  const trust = ["lib>app:write"];
  it("reads one direction + action", () => {
    expect(isTrusted(trust, "lib", "app", "write")).toBe(true);
    expect(isTrusted(trust, "app", "lib", "write")).toBe(false);
    expect(isTrusted(trust, "lib", "app", "read")).toBe(false);
  });
  it("sees trust in either direction of a pair", () => {
    expect(pairHasTrust(trust, "app", "lib")).toBe(true);
    expect(pairHasTrust(trust, "app", "docs")).toBe(false);
  });
});

describe("defaultPosition", () => {
  it("lays unplaced projects in a grid below the placed ones", () => {
    expect(defaultPosition(0, {})).toEqual({ x: 0, y: 0 });
    expect(defaultPosition(5, {})).toEqual({ x: 240, y: 140 });
    expect(defaultPosition(0, { a: { x: 50, y: 300 } })).toEqual({ x: 0, y: 440 });
  });
});

describe("pairAudit", () => {
  it("keeps the pair's entries, newest first, capped", () => {
    const entry = (at: number, from: string, to: string) => ({ at, from, to, pane: "p", action: "read" as const, via: "ask" as const });
    const audit = [entry(1, "lib", "app"), entry(2, "x", "y"), entry(3, "app", "lib"), entry(4, "lib", "app")];
    expect(pairAudit(audit, "app", "lib", 2).map((e) => e.at)).toEqual([4, 3]);
  });
});

describe("borderPoint", () => {
  const box = { x: 0, y: 0, width: 100, height: 40 }; // center (50, 20)
  it("leaves through the side facing the other node", () => {
    expect(borderPoint(box, { x: 300, y: 0, width: 100, height: 40 })).toEqual({ x: 100, y: 20 }); // right
    expect(borderPoint(box, { x: -300, y: 0, width: 100, height: 40 })).toEqual({ x: 0, y: 20 }); // left
    expect(borderPoint(box, { x: 0, y: 300, width: 100, height: 40 })).toEqual({ x: 50, y: 40 }); // bottom
    expect(borderPoint(box, { x: 0, y: -300, width: 100, height: 40 })).toEqual({ x: 50, y: 0 }); // top
  });
  it("hits a corner-side point on a diagonal", () => {
    const p = borderPoint(box, { x: 100, y: 200, width: 100, height: 40 }); // direction (100, 200)
    expect(p.y).toBe(40);
    expect(p.x).toBeCloseTo(60);
  });
  it("returns the center when both nodes overlap exactly", () => {
    expect(borderPoint(box, box)).toEqual({ x: 50, y: 20 });
  });
});

describe("projectsInZone", () => {
  it("counts a project in when its center is inside, whatever sticks out", () => {
    const zone = { x: 0, y: 0, width: 300, height: 200 };
    const projects = [
      { id: "in", x: 10, y: 10, width: 100, height: 40 },
      { id: "edge", x: 250, y: 10, width: 100, height: 40 }, // center x 300 — on the border
      { id: "out", x: 280, y: 10, width: 100, height: 40 }, // center x 330
    ];
    expect(projectsInZone(zone, projects)).toEqual(["in", "edge"]);
  });
});

describe("rectFromDrag", () => {
  it("normalizes a drag in any direction", () => {
    expect(rectFromDrag({ x: 10, y: 10 }, { x: 110, y: 60 })).toEqual({ x: 10, y: 10, width: 100, height: 50 });
    expect(rectFromDrag({ x: 110, y: 60 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 100, height: 50 });
  });
});
