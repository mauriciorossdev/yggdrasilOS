import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bracketedPaste, submitText, type SubmitTarget } from "./terminalSubmit.js";

type FakePane = SubmitTarget & { writes: string[]; output: () => void; state: { alive: boolean; bracketed: boolean; last: number } };

function fakePane(bracketed = true): FakePane {
  const state = { alive: true, bracketed, last: Date.now() };
  const writes: string[] = [];
  return {
    state,
    writes,
    alive: () => state.alive,
    bracketedPaste: () => state.bracketed,
    lastOutputAt: () => state.last,
    write: (data) => writes.push(data),
    output: () => {
      state.last = Date.now();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bracketedPaste", () => {
  it("wraps the text and normalizes line endings", () => {
    expect(bracketedPaste("a\r\nb\rc\nd")).toBe("\x1b[200~a\nb\nc\nd\x1b[201~");
  });

  it("drops an embedded end marker so the paste can't close early", () => {
    expect(bracketedPaste("x\x1b[201~y")).toBe("\x1b[200~xy\x1b[201~");
  });
});

describe("submitText", () => {
  it("sends one bracketed paste, then Enter once output has settled", async () => {
    const pane = fakePane();
    const done = submitText(pane, "hello");
    await vi.advanceTimersByTimeAsync(0);
    expect(pane.writes).toEqual(["\x1b[200~hello\x1b[201~"]);

    // The app keeps redrawing for a while after the paste lands.
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(50);
      pane.output();
    }
    expect(pane.writes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(pane.writes).toEqual(["\x1b[200~hello\x1b[201~", "\r"]);
  });

  it("waits for the app to turn bracketed paste on before typing anything", async () => {
    const pane = fakePane(false);
    const done = submitText(pane, "task");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pane.writes).toEqual([]);

    pane.state.bracketed = true;
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(pane.writes).toEqual(["\x1b[200~task\x1b[201~", "\r"]);
  });

  it("falls back to raw text if the app never turns bracketed paste on", async () => {
    const pane = fakePane(false);
    const done = submitText(pane, "ls", { readyTimeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    expect(pane.writes).toEqual(["ls", "\r"]);
  });

  it("still presses Enter at the settle timeout if output never goes quiet", async () => {
    const pane = fakePane();
    const done = submitText(pane, "x", { settleTimeoutMs: 1_000 });
    const spinner = setInterval(() => pane.output(), 40);
    await vi.advanceTimersByTimeAsync(1_200);
    clearInterval(spinner);
    await done;
    expect(pane.writes.at(-1)).toBe("\r");
  });

  it("can deliver without submitting", async () => {
    const pane = fakePane();
    await submitText(pane, "draft", { pressEnter: false });
    expect(pane.writes).toEqual(["\x1b[200~draft\x1b[201~"]);
  });

  it("gives up quietly when the pane exits mid-way", async () => {
    const pane = fakePane();
    const done = submitText(pane, "x");
    await vi.advanceTimersByTimeAsync(10);
    pane.state.alive = false;
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    expect(pane.writes).toEqual(["\x1b[200~x\x1b[201~"]);
  });
});
