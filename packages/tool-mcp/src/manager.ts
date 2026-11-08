import type { McpServerConfig } from "@yggdrasil/config";
import type { AgentToolDefinition } from "@yggdrasil/tools-sdk";
import type { McpConnection } from "./client.js";

export type McpServerState = "connecting" | "connected" | "error" | "stopped";

export type McpServerStatus = {
  id: string;
  state: McpServerState;
  /** Kept for older clients: same as `state === "connected"`. */
  connected: boolean;
  toolCount: number;
  tools: string[];
  autoStart: boolean;
  error?: string;
};

export type McpManagerDeps = {
  connect(serverId: string, config: McpServerConfig): Promise<McpConnection>;
  bridge(serverId: string, connection: McpConnection): Promise<AgentToolDefinition[]>;
  addTool(tool: AgentToolDefinition): void;
  removeTools(names: string[]): void;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

type Entry = {
  fingerprint: string;
  autoStart: boolean;
  /** Bumped on every connect/disconnect so a connect that finishes late can tell it was superseded. */
  generation: number;
  state: McpServerState;
  connection?: McpConnection;
  toolNames: string[];
  error?: string;
};

export type McpServers = Record<string, McpServerConfig>;

/** Outcome of trying a server config without saving it or registering its tools. */
export type McpTestResult = {
  ok: boolean;
  toolCount: number;
  /** Tool names as the server reports them (no `mcp__<id>__` prefix). */
  tools: string[];
  durationMs: number;
  error?: string;
};

const TEST_ID = "connection-test";

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = String(v);
  return out;
}

/** Validates the server config a client sends to mcp.test (only the fields a connection needs). */
export function parseMcpTestServer(raw: unknown): McpServerConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("mcp.test: server must be an object");
  const r = raw as Record<string, unknown>;
  if (r.transport === "stdio") {
    if (typeof r.command !== "string" || !r.command.trim()) throw new Error("mcp.test: stdio server needs a command");
    const args = Array.isArray(r.args) ? r.args.map(String) : undefined;
    const env = stringRecord(r.env);
    return { transport: "stdio", command: r.command.trim(), ...(args ? { args } : {}), ...(env ? { env } : {}) };
  }
  if (r.transport === "http") {
    if (typeof r.url !== "string" || !r.url.trim()) throw new Error("mcp.test: http server needs a url");
    const headers = stringRecord(r.headers);
    return { transport: "http", url: r.url.trim(), ...(headers ? { headers } : {}) };
  }
  throw new Error('mcp.test: transport must be "stdio" or "http"');
}

/**
 * The form never holds a server's saved env/headers (the client only ever sees them stripped), so a
 * test with those fields left blank means "use the saved ones", same as saving does.
 */
export function resolveTestConfig(candidate: McpServerConfig, saved: McpServerConfig | undefined): McpServerConfig {
  if (!saved || saved.transport !== candidate.transport) return candidate;
  if (candidate.transport === "stdio" && saved.transport === "stdio") {
    const hasEnv = candidate.env && Object.keys(candidate.env).length > 0;
    return !hasEnv && saved.env ? { ...candidate, env: saved.env } : candidate;
  }
  if (candidate.transport === "http" && saved.transport === "http") {
    const hasHeaders = candidate.headers && Object.keys(candidate.headers).length > 0;
    return !hasHeaders && saved.headers ? { ...candidate, headers: saved.headers } : candidate;
  }
  return candidate;
}

/**
 * Owns the lifecycle of every configured MCP server so the gateway never has
 * to wait for them: `start()` kicks connections off in the background, tools
 * are registered as each server comes up, and `reload`/`reconnect`/`disconnect`
 * let the app change that at runtime without restarting the gateway.
 */
export function createMcpManager(deps: McpManagerDeps) {
  const entries = new Map<string, Entry>();

  function toStatus(id: string, entry: Entry): McpServerStatus {
    return {
      id,
      state: entry.state,
      connected: entry.state === "connected",
      toolCount: entry.toolNames.length,
      tools: [...entry.toolNames],
      autoStart: entry.autoStart,
      ...(entry.error ? { error: entry.error } : {}),
    };
  }

  async function release(entry: Entry): Promise<void> {
    const connection = entry.connection;
    entry.connection = undefined;
    if (entry.toolNames.length > 0) {
      deps.removeTools(entry.toolNames);
      entry.toolNames = [];
    }
    if (connection) await connection.close().catch(() => {});
  }

  function ensureEntry(id: string, config: McpServerConfig): Entry {
    let entry = entries.get(id);
    if (!entry) {
      entry = { fingerprint: "", autoStart: true, generation: 0, state: "stopped", toolNames: [] };
      entries.set(id, entry);
    }
    entry.fingerprint = JSON.stringify(config);
    entry.autoStart = config.autoStart !== false;
    return entry;
  }

  async function connectServer(id: string, config: McpServerConfig): Promise<McpServerStatus> {
    const entry = ensureEntry(id, config);
    const generation = ++entry.generation;
    // Flip to "connecting" before the first await so status() right after a
    // fire-and-forget start() already reflects it.
    entry.state = "connecting";
    entry.error = undefined;
    await release(entry);

    let connection: McpConnection | undefined;
    try {
      connection = await deps.connect(id, config);
      if (entry.generation !== generation) {
        await connection.close().catch(() => {});
        return toStatus(id, entry);
      }
      const tools = await deps.bridge(id, connection);
      if (entry.generation !== generation) {
        await connection.close().catch(() => {});
        return toStatus(id, entry);
      }
      for (const tool of tools) deps.addTool(tool);
      entry.connection = connection;
      entry.toolNames = tools.map((t) => t.name);
      entry.state = "connected";
      deps.logger.info("connected MCP server", { serverId: id, tools: tools.length });
    } catch (err) {
      if (connection) await connection.close().catch(() => {});
      if (entry.generation === generation) {
        entry.state = "error";
        entry.error = err instanceof Error ? err.message : String(err);
        deps.logger.error("failed to connect MCP server", { serverId: id, error: entry.error });
      }
    }
    return toStatus(id, entry);
  }

  async function disconnectServer(id: string): Promise<void> {
    const entry = entries.get(id);
    if (!entry) return;
    entry.generation++;
    await release(entry);
    entry.state = "stopped";
    entry.error = undefined;
  }

  function status(servers: McpServers): McpServerStatus[] {
    return Object.entries(servers).map(([id, config]) => {
      const entry = entries.get(id);
      if (entry) return toStatus(id, { ...entry, autoStart: config.autoStart !== false });
      return {
        id,
        state: "stopped" as const,
        connected: false,
        toolCount: 0,
        tools: [],
        autoStart: config.autoStart !== false,
      };
    });
  }

  return {
    /** Kick off every autoStart server without waiting for any of them. */
    start(servers: McpServers): void {
      for (const [id, config] of Object.entries(servers)) {
        if (config.autoStart === false) {
          ensureEntry(id, config);
          continue;
        }
        void connectServer(id, config);
      }
    },

    async stop(): Promise<void> {
      await Promise.all([...entries.keys()].map((id) => disconnectServer(id)));
      entries.clear();
    },

    /**
     * Bring running state in line with `servers`: drop removed ones, (re)connect
     * new or changed autoStart ones, leave untouched ones alone. Does not wait
     * for the connections — callers poll status().
     */
    async reload(servers: McpServers): Promise<McpServerStatus[]> {
      for (const id of [...entries.keys()]) {
        if (!(id in servers)) {
          await disconnectServer(id);
          entries.delete(id);
        }
      }
      for (const [id, config] of Object.entries(servers)) {
        const previous = entries.get(id);
        const changed = previous !== undefined && previous.fingerprint !== JSON.stringify(config);
        const entry = ensureEntry(id, config);
        if (config.autoStart === false) {
          if (changed) await disconnectServer(id);
          continue;
        }
        const alive = entry.state === "connected" || entry.state === "connecting";
        if (!previous || changed || !alive) void connectServer(id, config);
      }
      return status(servers);
    },

    /** Reconnect one server and wait for the outcome (works for autoStart: false too). */
    async reconnect(id: string, servers: McpServers): Promise<McpServerStatus> {
      const config = servers[id];
      if (!config) throw new Error(`mcp.reconnect: unknown server "${id}"`);
      return connectServer(id, config);
    },

    async disconnect(id: string): Promise<void> {
      await disconnectServer(id);
    },

    /**
     * Connect with `config`, list its tools and hang up — without touching the running servers or
     * registering anything — so the Settings form can check a config before it is saved.
     */
    async test(config: McpServerConfig): Promise<McpTestResult> {
      const started = Date.now();
      let connection: McpConnection | undefined;
      try {
        connection = await deps.connect(TEST_ID, config);
        const defs = await deps.bridge(TEST_ID, connection);
        const prefix = `mcp__${TEST_ID}__`;
        const tools = defs.map((d) => (d.name.startsWith(prefix) ? d.name.slice(prefix.length) : d.name));
        return { ok: true, toolCount: tools.length, tools, durationMs: Date.now() - started };
      } catch (err) {
        return {
          ok: false,
          toolCount: 0,
          tools: [],
          durationMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        if (connection) await connection.close().catch(() => {});
      }
    },

    status,
  };
}
