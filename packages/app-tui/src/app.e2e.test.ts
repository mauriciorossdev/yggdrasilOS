import { EventEmitter } from "node:events";
import React from "react";
import { render as inkRender } from "ink";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "./components/App.js";
import { createTestPlatform } from "../../../test/helpers/index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForFrame(lastFrame: () => string | undefined, needle: string, timeoutMs = 8000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = lastFrame() ?? "";
    if (frame.includes(needle)) return frame;
    await sleep(50);
  }
  throw new Error(`timed out waiting for "${needle}"; last frame:\n${lastFrame()}`);
}

describe("TUI against a real gateway", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;
  let unmount: (() => void) | undefined;

  afterEach(async () => {
    unmount?.();
    unmount = undefined;
    await platform?.close();
  });

  it("connects, chats, and opens the /tools and /turns views", async () => {
    platform = await createTestPlatform({
      startServer: true,
      configOverride: { agents: [{ id: "default", provider: "builtin", model: "echo" }] },
    });

    const app = render(React.createElement(App, { gatewayUrl: `ws://127.0.0.1:${platform.gatewayPort}` }));
    unmount = app.unmount;

    await waitForFrame(app.lastFrame, "agent:default");

    const type = async (text: string) => {
      for (const ch of text) {
        app.stdin.write(ch);
        await sleep(5);
      }
      await sleep(30);
      app.stdin.write("\r");
    };

    await type("hola tui");
    await waitForFrame(app.lastFrame, "echo: hola tui");

    await type("/turns");
    // "Recent turns" alone also appears in the autocomplete row, so wait for text only the view has.
    const turns = await waitForFrame(app.lastFrame, "gateway-wide");
    expect(turns).not.toContain("No turns recorded");
    expect(turns).toContain("this session");
    app.stdin.write("\u001B");
    await sleep(150);

    await type("/tools");
    await waitForFrame(app.lastFrame, "pgup/pgdn");
  });

  it("starts in the requested approval mode and applies it on the gateway", async () => {
    platform = await createTestPlatform({
      startServer: true,
      configOverride: { agents: [{ id: "default", provider: "builtin", model: "echo" }] },
    });

    const app = render(
      React.createElement(App, { gatewayUrl: `ws://127.0.0.1:${platform.gatewayPort}`, initialMode: "plan" }),
    );
    unmount = app.unmount;

    await waitForFrame(app.lastFrame, "agent:default");
    const frame = await waitForFrame(app.lastFrame, "plan");
    expect(frame).toContain("plan");
  });

  it("keeps the input and status bar pinned to the bottom of the terminal", async () => {
    platform = await createTestPlatform({
      startServer: true,
      configOverride: { agents: [{ id: "default", provider: "builtin", model: "echo" }] },
    });

    const ROWS = 30;
    const stdout = Object.assign(new EventEmitter(), {
      columns: 100,
      rows: ROWS,
      isTTY: true,
      chunks: [] as string[],
      write(chunk: string) {
        this.chunks.push(chunk);
        return true;
      },
    });
    const stdin = Object.assign(new EventEmitter(), {
      isTTY: true,
      setRawMode() {},
      setEncoding() {},
      ref() {},
      unref() {},
      resume() {},
      pause() {},
      read: () => null,
    });
    const strip = (s: string) => s.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "");
    const lastScreen = () => strip(stdout.chunks.filter((c) => c.includes("agent:")).at(-1) ?? "").split("\n");

    const instance = inkRender(React.createElement(App, { gatewayUrl: `ws://127.0.0.1:${platform.gatewayPort}` }), {
      stdout: stdout as never,
      stdin: stdin as never,
      exitOnCtrlC: false,
      patchConsole: false,
      // Ink turns itself non-interactive when CI is set and then only writes the last frame.
      interactive: true,
    });
    unmount = () => instance.unmount();

    await waitForFrame(() => lastScreen().join("\n"), "agent:default");
    await sleep(100);
    const lines = lastScreen();

    // The frame fills the whole terminal, and the last lines are the status bar's box, not blank space.
    expect(lines.length).toBeGreaterThanOrEqual(ROWS);
    const lastNonEmpty = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim() !== "").at(-1)!;
    expect(lastNonEmpty[1]).toBeGreaterThanOrEqual(ROWS - 2);
    expect(lastNonEmpty[0]).toContain("└");
    // The input box sits right above the status bar (2 more rows of border + text), not in the middle.
    const inputRow = lines.findIndex((l) => l.includes("Type a message"));
    expect(inputRow).toBeGreaterThan(ROWS - 10);
  });
});
