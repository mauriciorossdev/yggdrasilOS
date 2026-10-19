import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { OutboundContext } from "@yggdrasil/sdk";
import { tuiChannel } from "./channel.js";

const BOLD = "\x1b[1m";

describe("tui channel outbound", () => {
  let writes: string[];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    writes = [];
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  function ctxFor(sessionKey: string): OutboundContext {
    return { channelId: "tui", accountId: "default", sessionKey };
  }

  it("sendText renders markdown and writes it immediately", async () => {
    await tuiChannel.outbound!.sendText!(ctxFor("s-text"), "**hi**");
    const out = writes.join("");
    expect(out).toContain(`${BOLD}hi`);
    expect(out.startsWith("→ ")).toBe(true);
  });

  it("sendFinal without prior streaming writes the final text directly", async () => {
    await tuiChannel.outbound!.sendFinal!(ctxFor("s-final-direct"), { text: "done" });
    const out = writes.join("");
    expect(out).toContain("done");
  });

  it("sendBlock accumulates a streaming buffer, and sendFinal flushes it once", async () => {
    const ctx = ctxFor("s-stream");
    await tuiChannel.outbound!.sendBlock!(ctx, { text: "chunk-1" });
    await tuiChannel.outbound!.sendBlock!(ctx, { text: "-chunk-2" });
    writes.length = 0;

    await tuiChannel.outbound!.sendFinal!(ctx, { text: "chunk-1-chunk-2" });

    const out = writes.join("");
    expect(out).toContain("chunk-1-chunk-2");
  });
});
