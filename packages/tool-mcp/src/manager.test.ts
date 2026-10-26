import { describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "@yggdrasil/config";
import type { AgentToolDefinition } from "@yggdrasil/tools-sdk";
import type { McpConnection } from "./client.js";
import { createMcpManager, type McpServers } from "./manager.js";

const stdio = (command: string, extra: Partial<McpServerConfig> = {}): McpServerConfig =>
  ({ transport: "stdio", command, ...extra }) as McpServerConfig;

function tool(name: string): AgentToolDefinition {
  return { name, description: name, parameters: { type: "object", properties: {} }, execute: async () => null } as AgentToolDefinition;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const registered = new Map<string, AgentToolDefinition>();
  const connections: Array<{ id: string; close: ReturnType<typeof vi.fn> }> = [];
  const pending = new Map<string, ReturnType<typeof deferred<void>>>();
  const failing = new Set<string>();

  const manager = createMcpManager({
    connect: async (id) => {
      const gate = pending.get(id);
      if (gate) await gate.promise;
      if (failing.has(id)) throw new Error(`boom ${id}`);
      const close = vi.fn(async () => {});
      connections.push({ id, close });
      return { serverId: id, client: {} as never, close } satisfies McpConnection;
    },
    bridge: async (id) => [tool(`mcp__${id}__a`), tool(`mcp__${id}__b`)],
    addTool: (t) => registered.set(t.name, t),
    removeTools: (names) => names.forEach((n) => registered.delete(n)),
    logger: { info: () => {}, error: () => {} },
  });
  return { manager, registered, connections, pending, failing };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("mcp manager", () => {
  it("start() returns immediately and registers tools as servers connect", async () => {
    const { manager, registered, pending } = setup();
    const slow = deferred<void>();
    pending.set("slow", slow);
    const servers: McpServers = { fast: stdio("a"), slow: stdio("b") };

    manager.start(servers);
    expect(manager.status(servers).map((s) => s.state)).toEqual(["connecting", "connecting"]);

    await flush();
    expect(manager.status(servers).map((s) => s.state)).toEqual(["connected", "connecting"]);
    expect([...registered.keys()]).toEqual(["mcp__fast__a", "mcp__fast__b"]);

    slow.resolve();
    await flush();
    expect(registered.size).toBe(4);
  });

  it("autoStart: false servers stay stopped until reconnect", async () => {
    const { manager, registered, connections } = setup();
    const servers: McpServers = { blender: stdio("uvx", { autoStart: false }) };

    manager.start(servers);
    await flush();
    expect(connections).toHaveLength(0);
    expect(manager.status(servers)[0]).toMatchObject({ state: "stopped", autoStart: false });

    const status = await manager.reconnect("blender", servers);
    expect(status).toMatchObject({ state: "connected", toolCount: 2 });
    expect(registered.size).toBe(2);
  });

  it("one failing server does not affect the others and reports its error", async () => {
    const { manager, registered, failing } = setup();
    failing.add("bad");
    const servers: McpServers = { bad: stdio("x"), good: stdio("y") };

    manager.start(servers);
    await flush();
    const [bad, good] = manager.status(servers);
    expect(bad).toMatchObject({ state: "error", connected: false, error: "boom bad" });
    expect(good).toMatchObject({ state: "connected", connected: true });
    expect([...registered.keys()]).toEqual(["mcp__good__a", "mcp__good__b"]);
  });

  it("reconnect replaces the old connection and its tools", async () => {
    const { manager, registered, connections } = setup();
    const servers: McpServers = { s: stdio("a") };
    manager.start(servers);
    await flush();

    await manager.reconnect("s", servers);
    expect(connections).toHaveLength(2);
    expect(connections[0].close).toHaveBeenCalledOnce();
    expect(registered.size).toBe(2);
  });

  it("reload connects new, drops removed, and leaves unchanged servers alone", async () => {
    const { manager, registered, connections } = setup();
    manager.start({ keep: stdio("k"), gone: stdio("g") });
    await flush();
    expect(connections.map((c) => c.id)).toEqual(["keep", "gone"]);

    const next: McpServers = { keep: stdio("k"), added: stdio("n") };
    await manager.reload(next);
    await flush();

    expect(connections.map((c) => c.id)).toEqual(["keep", "gone", "added"]);
    expect(connections[1].close).toHaveBeenCalledOnce();
    expect(connections[0].close).not.toHaveBeenCalled();
    expect([...registered.keys()].sort()).toEqual([
      "mcp__added__a",
      "mcp__added__b",
      "mcp__keep__a",
      "mcp__keep__b",
    ]);
  });

  it("reload reconnects a server whose config changed", async () => {
    const { manager, connections } = setup();
    manager.start({ s: stdio("old") });
    await flush();

    await manager.reload({ s: stdio("new") });
    await flush();
    expect(connections).toHaveLength(2);
    expect(connections[0].close).toHaveBeenCalledOnce();
  });

  it("reload disconnects a connected server switched to autoStart: false", async () => {
    const { manager, registered } = setup();
    manager.start({ s: stdio("a") });
    await flush();

    const [status] = await manager.reload({ s: stdio("a", { autoStart: false }) });
    expect(status).toMatchObject({ state: "stopped", autoStart: false });
    expect(registered.size).toBe(0);
  });

  it("a connect that finishes after disconnect is closed and registers nothing", async () => {
    const { manager, registered, connections, pending } = setup();
    const gate = deferred<void>();
    pending.set("s", gate);
    const servers: McpServers = { s: stdio("a") };

    manager.start(servers);
    await manager.disconnect("s");
    gate.resolve();
    await flush();

    expect(registered.size).toBe(0);
    expect(connections[0].close).toHaveBeenCalledOnce();
    expect(manager.status(servers)[0].state).toBe("stopped");
  });

  it("reconnect rejects for an unknown server id", async () => {
    const { manager } = setup();
    await expect(manager.reconnect("nope", {})).rejects.toThrow(/unknown server/);
  });

  it("stop() closes every connection and clears tools", async () => {
    const { manager, registered, connections } = setup();
    manager.start({ a: stdio("a"), b: stdio("b") });
    await flush();

    await manager.stop();
    expect(registered.size).toBe(0);
    expect(connections.every((c) => c.close.mock.calls.length === 1)).toBe(true);
  });
});
