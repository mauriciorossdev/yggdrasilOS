import { EventEmitter } from "node:events";
import React from "react";
import { render } from "ink";
import { App } from "../components/App.js";

export type TuiHandle = {
  /** Types text as a person would, then presses Enter. */
  submit: (text: string) => Promise<void>;
  /** Writes raw keys, e.g. "y", "\u001B" for Esc. */
  press: (keys: string) => void;
  /** The most recent full frame, ANSI stripped, one string per terminal row. */
  screen: () => string[];
  unmount: () => void;
};

export type MountOptions = {
  gatewayUrl: string;
  /** Join this session instead of minting one, so a driver knows which events are the TUI's. */
  sessionKey?: string;
  columns?: number;
  rows?: number;
};

const ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mounts the real <App> on a fake terminal (no TTY needed) and hands back a keyboard and a screen.
 * Used by the agentic evals to drive the TUI the way a user would, and by tests that want to read
 * what is actually drawn.
 */
export function mountTui(options: MountOptions): TuiHandle {
  const { columns = 120, rows = 40 } = options;
  const chunks: string[] = [];
  const stdout = Object.assign(new EventEmitter(), {
    columns,
    rows,
    isTTY: true,
    write(chunk: string) {
      chunks.push(chunk);
      if (chunks.length > 200) chunks.splice(0, chunks.length - 100);
      return true;
    },
  });
  // Same shape ink-testing-library uses: queued data announced with "readable", drained by read().
  let queued: string | null = null;
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode() {},
    setEncoding() {},
    ref() {},
    unref() {},
    resume() {},
    pause() {},
    read() {
      const data = queued;
      queued = null;
      return data;
    },
  });

  const instance = render(
    React.createElement(App, {
      gatewayUrl: options.gatewayUrl,
      initialSessionKey: options.sessionKey,
    }),
    {
      stdout: stdout as never,
      stdin: stdin as never,
      exitOnCtrlC: false,
      patchConsole: false,
      // Ink treats CI=1 as non-interactive and then only draws the last frame at unmount, which would leave a
      // driver reading an empty screen (the Docker sandbox sets CI=1). This fake terminal is always interactive.
      interactive: true,
    },
  );

  const write = (keys: string) => {
    queued = keys;
    stdin.emit("readable");
    stdin.emit("data", keys);
  };

  return {
    async submit(text: string) {
      for (const ch of text) {
        write(ch);
        // Ink handles one input event per tick; typing faster than this drops characters.
        await sleep(4);
      }
      await sleep(40);
      write("\r");
    },
    press: write,
    screen() {
      // A frame is one write that carries the whole screen; take the latest that has content.
      const last = [...chunks].reverse().find((c) => c.replace(ANSI, "").trim().length > 0) ?? "";
      return last.replace(ANSI, "").split("\n");
    },
    unmount: () => instance.unmount(),
  };
}
