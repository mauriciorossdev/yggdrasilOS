import React from "react";
import { Text } from "ink";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { useKeybinds } from "./useKeybinds.js";
import type { ViewMode } from "../state/store.js";

function Harness(props: { canCancel: boolean; viewMode?: ViewMode; onCancel: () => void; onExit: () => void }) {
  useKeybinds(() => {}, props.viewMode ?? "chat", props.onExit, () => {}, props.onCancel, props.canCancel);
  return React.createElement(Text, null, "ok");
}

const CTRL_C = "\u0003";
const ESC = "\u001B";
const tick = () => new Promise((r) => setTimeout(r, 80));

async function press(props: Parameters<typeof Harness>[0], key: string): Promise<void> {
  const { stdin } = render(React.createElement(Harness, props));
  await tick(); // let useInput subscribe
  stdin.write(key);
  await tick(); // Esc is held back briefly to tell it from an escape sequence
}

describe("useKeybinds cancel", () => {
  it("Ctrl+C cancels a running turn instead of quitting", async () => {
    const onCancel = vi.fn();
    const onExit = vi.fn();
    await press({ canCancel: true, onCancel, onExit }, CTRL_C);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("Ctrl+C quits when nothing is running", async () => {
    const onCancel = vi.fn();
    const onExit = vi.fn();
    await press({ canCancel: false, onCancel, onExit }, CTRL_C);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Esc cancels a running turn in the chat view", async () => {
    const onCancel = vi.fn();
    await press({ canCancel: true, onCancel, onExit: () => {} }, ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Esc does nothing to a turn from another view", async () => {
    const onCancel = vi.fn();
    await press({ canCancel: true, viewMode: "command-palette", onCancel, onExit: () => {} }, ESC);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
