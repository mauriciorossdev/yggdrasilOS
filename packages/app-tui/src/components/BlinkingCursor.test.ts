import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { BlinkingCursor } from "./BlinkingCursor.js";
import { InputBox } from "./InputBox.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CURSOR = "█";

describe("BlinkingCursor", () => {
  it("blinks while active", async () => {
    const { lastFrame } = render(React.createElement(BlinkingCursor, { intervalMs: 40 }));
    const seen = new Set<boolean>();
    for (let i = 0; i < 12; i++) {
      seen.add((lastFrame() ?? "").includes(CURSOR));
      await sleep(25);
    }
    expect(seen).toEqual(new Set([true, false]));
  });

  it("shows nothing and stays still when inactive", async () => {
    const { lastFrame } = render(React.createElement(BlinkingCursor, { active: false, intervalMs: 20 }));
    await sleep(80);
    expect(lastFrame()).not.toContain(CURSOR);
  });
});

describe("InputBox cursor", () => {
  const base = { onSubmit: () => {}, inputHistory: [], historyIndex: -1, onHistoryChange: () => {} };

  it("shows the cursor on an empty input, before the placeholder", () => {
    const frame = render(React.createElement(InputBox, { ...base, placeholder: "Type a message…" })).lastFrame() ?? "";
    expect(frame).toMatch(/❯ █Type a message…/);
  });

  it("follows what is typed and is solid right after a keystroke", async () => {
    const { stdin, lastFrame } = render(React.createElement(InputBox, { ...base, placeholder: "Type" }));
    await sleep(80);
    stdin.write("h");
    await sleep(80);
    stdin.write("i");
    await sleep(60);
    expect(lastFrame()).toContain(`hi${CURSOR}`);
  });

  it("hides the cursor while the input is disabled", () => {
    const frame = render(React.createElement(InputBox, { ...base, disabled: true, placeholder: "Waiting…" })).lastFrame() ?? "";
    expect(frame).not.toContain(CURSOR);
  });
});
