import { describe, expect, it, vi } from "vitest";
import { encodeMessage } from "./framing.js";
import { createLspManager, type LspChannel } from "./manager.js";

function fakeChannel(ownsServer = true) {
  let onData: (chunk: Buffer) => void = () => {};
  const closers: Array<(reason: string | null) => void> = [];
  const written: unknown[] = [];
  const channel: LspChannel = {
    ownsServer,
    write: (data) => {
      const text = data.toString();
      written.push(JSON.parse(text.slice(text.indexOf("\r\n\r\n") + 4)));
    },
    onData: (h) => void (onData = h),
    onClose: (h) => void closers.push(h),
    kill: vi.fn(),
  };
  return {
    channel,
    written,
    receive: (message: unknown) => onData(encodeMessage(message)),
    close: (reason: string | null = null) => closers.forEach((c) => c(reason)),
  };
}

function setup(graceMs = 5) {
  const onMessage = vi.fn();
  const onClose = vi.fn();
  return { onMessage, onClose, manager: createLspManager({ onMessage, onClose, graceMs }) };
}

describe("lsp manager", () => {
  it("reuses a session per owner and server", () => {
    const { manager } = setup();
    const open = vi.fn(() => fakeChannel().channel);
    const a = manager.start("p1", "ts", open);
    expect(manager.start("p1", "ts", open)).toBe(a);
    expect(manager.start("p2", "ts", open)).not.toBe(a);
    expect(manager.start("p1", "eslint", open)).not.toBe(a);
    expect(open).toHaveBeenCalledTimes(3);
    expect(manager.runningServers("p1")).toEqual(["ts", "eslint"]);
  });

  it("relays messages both ways", () => {
    const { manager, onMessage } = setup();
    const fake = fakeChannel();
    const id = manager.start("p1", "ts", () => fake.channel);
    manager.send("p1", id, { method: "x" });
    expect(fake.written).toEqual([{ method: "x" }]);
    fake.receive({ id: 1, result: null });
    expect(onMessage).toHaveBeenCalledWith("p1", id, { id: 1, result: null });
  });

  it("won't let an owner reach another owner's session", () => {
    const { manager } = setup();
    const fake = fakeChannel();
    const id = manager.start("p1", "ts", () => fake.channel);
    manager.send("p2", id, { method: "x" });
    expect(fake.written).toEqual([]);
  });

  it("only allows URIs its own servers returned as locations", () => {
    const { manager } = setup();
    const fake = fakeChannel();
    manager.start("p1", "ts", () => fake.channel);
    fake.receive({ id: 1, result: [{ uri: "file:///lib.d.ts" }, { targetUri: "file:///b.ts" }] });
    fake.receive({ id: 2, result: { uri: "file:///c.ts" } });
    fake.receive({ method: "textDocument/publishDiagnostics", params: { uri: "file:///secret" } });
    expect(manager.isAllowedUri("p1", "file:///lib.d.ts")).toBe(true);
    expect(manager.isAllowedUri("p1", "file:///b.ts")).toBe(true);
    expect(manager.isAllowedUri("p1", "file:///c.ts")).toBe(true);
    expect(manager.isAllowedUri("p1", "file:///secret")).toBe(false);
    expect(manager.isAllowedUri("p2", "file:///lib.d.ts")).toBe(false);
  });

  it("reports an unexpected exit and opens a new session next time", () => {
    const { manager, onClose } = setup();
    const fake = fakeChannel();
    const id = manager.start("p1", "ts", () => fake.channel);
    fake.close("crashed");
    expect(onClose).toHaveBeenCalledWith("p1", id, "crashed");
    expect(fake.channel.kill).toHaveBeenCalled();
    expect(manager.start("p1", "ts", () => fakeChannel().channel)).not.toBe(id);
  });

  it("stops politely: shutdown, then exit once answered, then kills what's left", async () => {
    const { manager, onClose } = setup(1000);
    const fake = fakeChannel();
    manager.start("p1", "ts", () => fake.channel);
    const stopped = manager.stopOwner("p1");
    expect(fake.written).toEqual([{ jsonrpc: "2.0", id: "ygg-shutdown", method: "shutdown" }]);
    fake.receive({ id: "ygg-shutdown", result: null });
    expect(fake.written[1]).toEqual({ jsonrpc: "2.0", method: "exit" });
    fake.close();
    await stopped;
    expect(fake.channel.kill).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(manager.runningServers("p1")).toEqual([]);
  });

  it("kills a server that ignores shutdown", async () => {
    const { manager } = setup(5);
    const fake = fakeChannel();
    manager.start("p1", "ts", () => fake.channel);
    await manager.stopOwner("p1");
    expect(fake.channel.kill).toHaveBeenCalled();
  });

  it("just disconnects from a server it doesn't own", async () => {
    const { manager } = setup();
    const fake = fakeChannel(false);
    manager.start("p1", "godot", () => fake.channel);
    await manager.stopOwner("p1");
    expect(fake.written).toEqual([]);
    expect(fake.channel.kill).toHaveBeenCalled();
  });
});
