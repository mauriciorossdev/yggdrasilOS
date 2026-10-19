import type { ContextProvider, ContextBlock, ContextProviderContext } from "@yggdrasil/context-sdk";
import { definePlugin } from "@yggdrasil/sdk";
import { defineTool } from "@yggdrasil/tools-sdk";
import {
  getMemoryDb,
  closeMemoryDb,
  queryMemories,
  addMemory,
  removeMemory,
  updateMemory,
  listAllMemories,
  searchMemories,
  indexProjectFile,
  searchProjectFiles,
  indexAllFiles,
  indexSinglePath,
  indexAllPluginStorage,
  indexPluginStorageKey,
  DEFAULT_INDEXABLE_EXTENSIONS,
} from "./db.js";

// Re-exported (not just used internally) so a host app (app-desktop's main
// process) can index/query a project's memory.db directly without going
// through this plugin's kernel registration — see
// app-desktop/src/main/pluginStorageIndex.ts.
export { getMemoryDb, closeMemoryDb, indexAllPluginStorage, indexPluginStorageKey, searchProjectFiles };

type MemoryDbConfig = { dbPath?: string; extensions?: string[]; watch?: boolean };

/** A configured `extensions` list replaces the default entirely rather than extending it — see db.ts's DEFAULT_INDEXABLE_EXTENSIONS comment. */
function getIndexableExtensions(cfg: MemoryDbConfig | undefined): string[] {
  return Array.isArray(cfg?.extensions) && cfg.extensions.length > 0 ? cfg.extensions : DEFAULT_INDEXABLE_EXTENSIONS;
}

function getDb(ctx: { config: unknown; workspaceRoot?: string }): ReturnType<typeof getMemoryDb> {
  const pluginCfg = (ctx.config as Record<string, unknown> | null)?.pluginConfig as Record<string, unknown> | undefined;
  const cfg = (pluginCfg?.["context-memory-db"] ?? {}) as MemoryDbConfig;
  // ctx.workspaceRoot is what a standalone MCP shim (memoryControlMcpShim.ts)
  // actually sets — falling back to process.cwd() keeps the kernel-plugin
  // call sites (which never set it) working exactly as before.
  return getMemoryDb(ctx.workspaceRoot ?? process.cwd(), cfg.dbPath);
}

function getDbConfig(ctx: { config: unknown }): MemoryDbConfig {
  const pluginCfg = (ctx.config as Record<string, unknown> | null)?.pluginConfig as Record<string, unknown> | undefined;
  return (pluginCfg?.["context-memory-db"] ?? {}) as MemoryDbConfig;
}

const memoryAddTool = defineTool({
  name: "memory_add",
  description:
    "Save a durable fact about the user to long-term memory (preferences, people, routines, decisions). Write one short, self-contained sentence. Check the Memories list first and use memory_update instead if it already exists.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "One self-contained sentence, e.g. \"Prefers alarms 10 minutes early\"." },
      type: { type: "string", description: "fact, preference, person, routine or decision (default fact)." },
    },
    required: ["content"],
  },
  async execute(ctx, args) {
    const db = getDb(ctx);
    const row = addMemory(db, String(args.content), typeof args.type === "string" ? args.type : "fact");
    return { id: row.id };
  },
});

const memoryListTool = defineTool({
  name: "memory_list",
  description: "List saved memories with their ids, newest first.",
  parameters: { type: "object", properties: { limit: { type: "number" } } },
  async execute(ctx, args) {
    const db = getDb(ctx);
    const rows = listAllMemories(db, undefined, typeof args.limit === "number" ? args.limit : 20);
    return { memories: rows };
  },
});

const memorySearchTool = defineTool({
  name: "memory_search",
  description: "Search saved memories by text; returns matches with their ids.",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  async execute(ctx, args) {
    const db = getDb(ctx);
    const rows = searchMemories(db, String(args.query));
    return { memories: rows };
  },
});

const projectIndexTool = defineTool({
  name: "project_index",
  description: "Index a file into project search index.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"]
  },
  async execute(ctx, args) {
    const db = getDb(ctx);
    indexProjectFile(db, args.path as string, args.content as string);
    return { success: true };
  }
});

const projectSearchTool = defineTool({
  name: "project_search",
  description: "Search project knowledge base.",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  async execute(ctx, args) {
    const db = getDb(ctx);
    const results = searchProjectFiles(db, args.query as string);
    return { results };
  }
});

const projectIndexAllTool = defineTool({
  name: "project_index_all",
  description: "Index all project files.",
  parameters: { type: "object", properties: {} },
  async execute(ctx) {
    const db = getDb(ctx);
    await indexAllFiles(db, process.cwd(), undefined, getIndexableExtensions(getDbConfig(ctx)));
    return { success: true };
  }
});

const memoryUpdateTool = defineTool({
  name: "memory_update",
  description: "Rewrite the content of an existing memory by id (ids appear in the Memories list and in search results).",
  parameters: {
    type: "object",
    properties: { id: { type: "number" }, content: { type: "string" } },
    required: ["id", "content"],
  },
  async execute(ctx, args) {
    const db = getDb(ctx);
    const ok = updateMemory(db, Number(args.id), { content: String(args.content) });
    return { ok };
  },
});

const memoryRemoveTool = defineTool({
  name: "memory_remove",
  description: "Forget a memory permanently by id. Find the id in the Memories list or with memory_search first.",
  parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  async execute(ctx, args) {
    const db = getDb(ctx);
    const ok = removeMemory(db, Number(args.id));
    return { ok };
  },
});

/**
 * Same underlying project_index FTS5 table as projectSearchTool, given its
 * own name/description for memoryControlMcpShim.ts's real-`claude`-CLI
 * exposure — there, project_index is deliberately populated ONLY from
 * plugin storage (indexAllPluginStorage / indexPluginStorageKey, called from
 * app-desktop's main process, not from this file's own indexAllFiles/
 * indexSinglePath path), so a generic "project_search" name would mislead an
 * agent into thinking it searches source files too. It doesn't, today.
 */
const pluginDataSearchTool = defineTool({
  name: "plugin_data_search",
  description:
    "Full-text search over this project's installed plugins' stored data (e.g. a kanban board's cards) — not project source files.",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  async execute(ctx, args) {
    const db = getDb(ctx);
    const results = searchProjectFiles(db, args.query as string);
    return { results };
  },
});

export const memoryDbProvider: ContextProvider = {
  id: "memory-db",
  label: "Memory Database",
  priority: 20,
  async assemble(ctx: ContextProviderContext): Promise<ContextBlock[]> {
    const cfg = ctx.config as { dbPath?: string } | undefined;
    const database = getMemoryDb(ctx.workspaceRoot, cfg?.dbPath);
    const rows = queryMemories(database, ctx.agentId);
    if (rows.length === 0) return [];
    return [{
      role: "system",
      content: `## Memories\n${rows.map(r => `- #${r.id} [${r.type}] ${r.content}`).join("\n")}`,
      source: "memory-db",
      priority: 20,
      cacheable: true,
      ttlMs: 60_000,
    }];
  },
};

export const memoryDbPlugin = definePlugin({
  id: "context-memory-db",
  name: "Memory Database Context",
  version: "0.1.0",
  register(api) {
    api.registerContextProvider(memoryDbProvider);
    api.registerTool(memoryAddTool);
    api.registerTool(memoryListTool);
    api.registerTool(memorySearchTool);
    api.registerTool(memoryUpdateTool);
    api.registerTool(memoryRemoveTool);
    api.registerTool(projectIndexTool);
    api.registerTool(projectSearchTool);
    api.registerTool(projectIndexAllTool);
    api.registerTool(pluginDataSearchTool);

    // Plugin handlers get no workspaceRoot of their own. Fall back to the
    // same root the CLI resolves (YGGDRASIL_WORKSPACE, e.g. /data/project on
    // Railway) so these RPCs hit the same memory.db as the agent's tools.
    const rpcDb = (_ctx: unknown) => {
      const globalCfg = api.globalConfig as { workspaceRoot?: string };
      const cfg = api.config as { dbPath?: string } | undefined;
      const root = globalCfg?.workspaceRoot ?? (process.env.YGGDRASIL_WORKSPACE?.trim() || process.cwd());
      return getMemoryDb(root, cfg?.dbPath);
    };

    api.registerGatewayMethod("memory.add", async (params, ctx) => {
      const content = String(params.content ?? "").trim();
      if (!content) throw new Error("content required");
      const row = addMemory(rpcDb(ctx), content, String(params.type ?? "fact"), params.agentId ? String(params.agentId) : undefined);
      return { memory: row };
    });

    api.registerGatewayMethod("memory.list", async (params, ctx) => {
      const limit = typeof params.limit === "number" ? params.limit : 200;
      return { memories: listAllMemories(rpcDb(ctx), params.agentId ? String(params.agentId) : undefined, limit) };
    });

    api.registerGatewayMethod("memory.update", async (params, ctx) => {
      const content = String(params.content ?? "").trim();
      if (!content) throw new Error("content required");
      return { ok: updateMemory(rpcDb(ctx), Number(params.id), { content }) };
    });

    api.registerGatewayMethod("memory.remove", async (params, ctx) => {
      return { ok: removeMemory(rpcDb(ctx), Number(params.id)) };
    });

    api.registerGatewayMethod("project_index_all", async (_params, ctx) => {
      const globalCfg = api.globalConfig as { workspaceRoot?: string };
      const workspaceRoot = globalCfg?.workspaceRoot ?? process.cwd();
      const cfg = api.config as MemoryDbConfig | undefined;
      const database = getMemoryDb(workspaceRoot, cfg?.dbPath);
      // SessionSidebar.tsx's "Indx" button progress bar (project_index.progress,
      // forwarded to WS clients by gateway/src/server.ts) — a real
      // processed/total count as the walk runs, not the old fake fixed bar.
      await indexAllFiles(
        database,
        workspaceRoot,
        (progress) => {
          void ctx.events.emit("project_index.progress", progress);
        },
        getIndexableExtensions(cfg),
      );
      return { success: true };
    });

    // Auto-reindex on save (SessionSidebar.tsx's "Indx" button is still
    // there for an explicit full reindex, e.g. right after opening a
    // project for the first time) — set `watch: false` in this plugin's
    // config to opt out. Rides the gateway's own single project-wide
    // chokidar watcher (fs-watch.ts's "fs.contentChanged", same shared
    // event bus) instead of running a second recursive one — two
    // independent native watchers on the same tree double the fd/handle
    // pressure, and a real project can already hit the OS's per-process
    // limit (EMFILE) with just the gateway's own watcher on a big enough
    // tree. registerService's start() is invoked once by startKernel()
    // during gateway boot.
    let unsubscribeContentChanged: (() => void) | null = null;
    api.registerService({
      id: "context-memory-db-watcher",
      start() {
        const cfg = api.config as MemoryDbConfig | undefined;
        if (cfg?.watch === false) return;
        const globalCfg = api.globalConfig as { workspaceRoot?: string };
        const workspaceRoot = globalCfg?.workspaceRoot ?? process.cwd();
        const database = getMemoryDb(workspaceRoot, cfg?.dbPath);
        const extensions = getIndexableExtensions(cfg);
        unsubscribeContentChanged = api.events.on("fs.contentChanged", (payload) => {
          const { paths } = payload as { paths: string[] };
          for (const relPath of paths) {
            void indexSinglePath(database, workspaceRoot, relPath, extensions).catch((err) => {
              console.warn(`[context-memory-db] failed to reindex ${relPath}:`, err);
            });
          }
        });
      },
      stop() {
        unsubscribeContentChanged?.();
        unsubscribeContentChanged = null;
      },
    });
  },
});

export default memoryDbPlugin;

// Re-exported so memoryControlMcpShim.ts (a standalone MCP stdio server, not
// the kernel plugin runtime above) can wrap these same AgentToolDefinitions
// directly — same "one implementation, two call paths" posture as
// tool-documents' own re-exports.
export { memoryAddTool, memoryListTool, memorySearchTool, memoryUpdateTool, memoryRemoveTool, pluginDataSearchTool };
