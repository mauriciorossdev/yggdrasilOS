import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { AgentToolDefinition } from "@yggdrasil/tools-sdk";
import type { ContextProviderContext } from "@yggdrasil/context-sdk";
import type { EventBus, EventHandler, GatewayHandler, ServicePlugin, YggdrasilPluginApi } from "@yggdrasil/sdk";
import { closeMemoryDb, getMemoryDb, addMemory, searchProjectFiles } from "./db.js";
import plugin, { memoryDbProvider } from "./index.js";

function noop(): void {}

/** Minimal real pub/sub (not a noop) — needed by tests that fire "fs.contentChanged" and expect the watcher service's handler to actually run. */
function fakeEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();
  return {
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) handlers.set(event, (set = new Set()));
      set.add(handler as EventHandler);
      return () => set!.delete(handler as EventHandler);
    },
    async emit(event, payload) {
      for (const handler of handlers.get(event) ?? []) await handler(payload);
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler);
    },
  };
}

function registerPlugin(options?: { config?: unknown; globalConfig?: unknown; events?: EventBus }): {
  methods: Map<string, GatewayHandler>;
  tools: Map<string, AgentToolDefinition>;
  services: Map<string, ServicePlugin>;
  events: EventBus;
} {
  const methods = new Map<string, GatewayHandler>();
  const tools = new Map<string, AgentToolDefinition>();
  const services = new Map<string, ServicePlugin>();
  const events = options?.events ?? fakeEventBus();
  const api: YggdrasilPluginApi = {
    pluginId: "context-memory-db",
    config: options?.config ?? {},
    globalConfig: options?.globalConfig ?? {},
    logger: { info: noop, warn: noop, error: noop, debug: noop } as unknown as YggdrasilPluginApi["logger"],
    events,
    registerHarness: noop,
    registerChannel: noop,
    registerProvider: noop,
    registerTool(tool) {
      if (typeof tool !== "function") tools.set(tool.name, tool);
    },
    registerGatewayMethod(name, handler) {
      methods.set(name, handler);
    },
    registerService(service) {
      services.set(service.id, service);
    },
    registerContextProvider: noop,
    registerSkillCommand: noop,
  };
  plugin.register(api);
  return { methods, tools, services, events };
}

// The tool wrappers resolve their db path against process.cwd() (not a
// workspaceRoot passed in), so tests give a dbPath that, once joined back
// with process.cwd(), lands inside our temp dir instead of the real repo.
function relativeDbPath(dbFile: string): string {
  return relative(process.cwd(), dbFile);
}

describe("context-memory-db plugin registration", () => {
  it("registers the memory tools and gateway methods", () => {
    const { methods, tools } = registerPlugin();
    expect(methods.has("memory.add")).toBe(true);
    expect(methods.has("memory.list")).toBe(true);
    expect(methods.has("memory.remove")).toBe(true);
    expect(methods.has("memory.update")).toBe(true);
    expect(tools.has("memory_add")).toBe(true);
    expect(tools.has("memory_list")).toBe(true);
    expect(tools.has("memory_search")).toBe(true);
    expect(tools.has("memory_update")).toBe(true);
    expect(tools.has("memory_remove")).toBe(true);
  });

  it("registers a context-memory-db-watcher service", () => {
    const { services } = registerPlugin();
    expect(services.has("context-memory-db-watcher")).toBe(true);
  });
});

describe("context-memory-db-watcher service (auto-reindex on save)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "memory-db-watcher-"));
    closeMemoryDb();
  });

  afterEach(() => {
    closeMemoryDb();
    rmSync(root, { recursive: true, force: true });
  });

  // Fires the gateway's own "fs.contentChanged" event (see
  // gateway/src/fs-watch.ts) — this plugin never runs its own file watcher,
  // it rides that shared one, so exercising the real subscription means
  // emitting the same event a real gateway would.
  it("reindexes a path when the shared watcher reports it changed", async () => {
    writeFileSync(join(root, "watched.ts"), "alpha via shared watcher");

    const { services, events } = registerPlugin({ globalConfig: { workspaceRoot: root } });
    const service = services.get("context-memory-db-watcher")!;
    await service.start({ config: {}, logger: { info: noop, warn: noop, error: noop, debug: noop } });

    const db = getMemoryDb(root);
    await events.emit("fs.contentChanged", { paths: ["watched.ts"] });
    // indexSinglePath's own fs work is async and fire-and-forgotten by the
    // handler (it can't block the event bus on disk I/O) — give it a tick.
    await new Promise((r) => setTimeout(r, 50));

    expect(searchProjectFiles(db, "alpha")).toHaveLength(1);

    await service.stop?.();
  });

  it("stops reacting after stop() unsubscribes", async () => {
    const filePath = join(root, "watched.ts");
    writeFileSync(filePath, "before stop");

    const { services, events } = registerPlugin({ globalConfig: { workspaceRoot: root } });
    const service = services.get("context-memory-db-watcher")!;
    await service.start({ config: {}, logger: { info: noop, warn: noop, error: noop, debug: noop } });
    await service.stop?.();

    writeFileSync(filePath, "after stop — should never be seen");
    await events.emit("fs.contentChanged", { paths: ["watched.ts"] });
    await new Promise((r) => setTimeout(r, 50));

    const db = getMemoryDb(root);
    expect(searchProjectFiles(db, "after")).toHaveLength(0);
  });

  it("does nothing when the plugin config sets watch: false", async () => {
    writeFileSync(join(root, "watched.ts"), "should stay unindexed");

    const { services, events } = registerPlugin({
      config: { watch: false },
      globalConfig: { workspaceRoot: root },
    });
    const service = services.get("context-memory-db-watcher")!;
    await service.start({ config: {}, logger: { info: noop, warn: noop, error: noop, debug: noop } });

    const db = getMemoryDb(root);
    await events.emit("fs.contentChanged", { paths: ["watched.ts"] });
    await new Promise((r) => setTimeout(r, 50));

    expect(searchProjectFiles(db, "unindexed")).toHaveLength(0);
  });
});

describe("memoryDbProvider", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "memory-db-provider-"));
    closeMemoryDb();
  });

  afterEach(() => {
    closeMemoryDb();
    rmSync(root, { recursive: true, force: true });
  });

  it("returns no blocks when there are no memories", async () => {
    const ctx: ContextProviderContext = {
      sessionKey: "s1",
      agentId: "default",
      workspaceRoot: root,
      config: {},
      globalConfig: {},
    };
    expect(await memoryDbProvider.assemble(ctx)).toEqual([]);
  });

  it("surfaces stored memories as a system block", async () => {
    const db = getMemoryDb(root, "memory.db");
    addMemory(db, "user likes dark mode", "preference");

    const ctx: ContextProviderContext = {
      sessionKey: "s1",
      agentId: "default",
      workspaceRoot: root,
      config: { dbPath: "memory.db" },
      globalConfig: {},
    };
    const blocks = await memoryDbProvider.assemble(ctx);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.content).toContain("user likes dark mode");
    expect(blocks[0]!.source).toBe("memory-db");
  });
});

describe("memory tools", () => {
  let root: string;
  let dbPath: string;
  let tools: Map<string, AgentToolDefinition>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "memory-db-tools-"));
    dbPath = relativeDbPath(join(root, "memory.db"));
    closeMemoryDb();
    ({ tools } = registerPlugin());
  });

  afterEach(() => {
    closeMemoryDb();
    rmSync(root, { recursive: true, force: true });
  });

  function ctxFor() {
    return { sessionKey: "s1", config: { pluginConfig: { "context-memory-db": { dbPath } } } };
  }

  it("memory_add stores a memory and memory_list returns it", async () => {
    const added = (await tools.get("memory_add")!.execute(ctxFor(), { content: "remember this" })) as {
      id: number;
      content: string;
    };
    expect(added.content).toBe("remember this");

    const listed = (await tools.get("memory_list")!.execute(ctxFor(), {})) as {
      memories: Array<{ id: number; content: string }>;
    };
    expect(listed.memories).toHaveLength(1);
    expect(listed.memories[0]!.content).toBe("remember this");
  });

  it("memory_search finds memories by keyword", async () => {
    await tools.get("memory_add")!.execute(ctxFor(), { content: "loves pizza" });
    await tools.get("memory_add")!.execute(ctxFor(), { content: "hates olives" });

    const result = (await tools.get("memory_search")!.execute(ctxFor(), { query: "pizza" })) as {
      memories: Array<{ content: string }>;
    };
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]!.content).toBe("loves pizza");
  });

  it("memory_update changes content, memory_remove deletes it", async () => {
    const added = (await tools.get("memory_add")!.execute(ctxFor(), { content: "old" })) as {
      id: number;
    };

    const updated = (await tools.get("memory_update")!.execute(ctxFor(), {
      id: added.id,
      content: "new",
    })) as { ok: boolean };
    expect(updated.ok).toBe(true);

    const listed = (await tools.get("memory_list")!.execute(ctxFor(), {})) as {
      memories: Array<{ content: string }>;
    };
    expect(listed.memories[0]!.content).toBe("new");

    const removed = (await tools.get("memory_remove")!.execute(ctxFor(), { id: added.id })) as {
      ok: boolean;
    };
    expect(removed.ok).toBe(true);

    const afterRemoval = (await tools.get("memory_list")!.execute(ctxFor(), {})) as {
      memories: unknown[];
    };
    expect(afterRemoval.memories).toHaveLength(0);
  });
});
