import { createInterface } from "node:readline";

/**
 * Standalone entry (built by electron-vite as its own bundle — see
 * electron.vite.config.ts's `main.build.rollupOptions.input`), spawned as
 * `node <resolved path>` by a `claude` CLI session's `.mcp.json`
 * (main/mcpConfig.ts's writePluginsMcpConfig) independent of Electron
 * itself. Same hand-rolled minimal MCP server shape as paneControlMcpShim.ts
 * — no @modelcontextprotocol/sdk, no zod — proxying every tool call to
 * paneControlServer.ts's `/plugins/*` routes on the SAME loopback HTTP
 * server the panes tool already uses (same PANE_CONTROL_URL/TOKEN env vars).
 */

type JsonRpcMessage = { jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, unknown> };

const CONTROL_URL = process.env.PANE_CONTROL_URL;
const CONTROL_TOKEN = process.env.PANE_CONTROL_TOKEN;

function logError(...args: unknown[]): void {
  // stdout is the JSON-RPC channel — diagnostics must go to stderr only.
  console.error("[plugins-control-mcp]", ...args);
}

if (!CONTROL_URL || !CONTROL_TOKEN) {
  logError("missing PANE_CONTROL_URL/PANE_CONTROL_TOKEN env vars — tool calls will fail");
}

async function callControl(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${CONTROL_URL}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${CONTROL_TOKEN}`, "content-type": "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `plugins control request failed (${res.status})`);
  return body;
}

const TOOLS = [
  {
    name: "scaffold_plugin",
    description:
      "Creates a new complemento (a folder with manifest.json + starter index.html/app.js/styles.css/README.md) " +
      "that shows up right away in the desktop app's sidebar under \"Complementos\". Use this whenever the user " +
      "asks for a mini app, a tool, a dashboard, an extension, or anything like \"build me a UI to manage X\" / " +
      '"crea un complemento para...". After scaffolding, edit the created files (plain HTML/JS/CSS, no build ' +
      "step) with your normal file tools, then call open_plugin so the user sees it. Call read_plugin_api_docs " +
      "first if you haven't already this session — it has the full manifest schema and the window.ygg API " +
      "available inside a complemento's page, including its permission model, which isn't guessable from this " +
      "tool's schema alone.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Lowercase id, e.g. \"tareas\" — becomes the folder name. Letters/digits/hyphens/underscores, max 64.",
        },
        name: { type: "string", description: "Human-readable name shown in the sidebar and as its tab/panel title." },
        icon: { type: "string", description: "A single emoji, e.g. \"📋\". Optional." },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description:
            'Defaults to "project" (visible only here). Use "global" only when the user explicitly wants it ' +
            "available from every project window instead of just this one.",
        },
        views: {
          type: "array",
          items: { type: "string", enum: ["tab", "panel", "mobile"] },
          description:
            'Where it can be opened — "tab" (a main tab next to Chat/Terminal/Documents), "panel" (the ' +
            'right-hand aside, same as an opened file), and/or "mobile" (the Yggdrasil phone app\'s own ' +
            "Complementos tab — add this when the user wants it usable from their phone, not just desktop). " +
            'Defaults to ["tab"].',
        },
        defaultView: { type: "string", enum: ["tab", "panel"], description: "Which view opening it from the sidebar uses first — desktop only, \"mobile\" isn't a valid value here. Defaults to the first tab/panel entry in views." },
        permissions: {
          type: "array",
          items: { type: "string" },
          description:
            'Which window.ygg capabilities this complemento gets: "fs" (read the project), "fs:write" (write ' +
            'it too), "panes" (spawn/write terminal panes), "gateway:<method>" (one exact gateway RPC method, ' +
            'e.g. "gateway:chat.send"). Leave empty for a complemento that only needs its own storage. See ' +
            "read_plugin_api_docs for the full list and what each unlocks.",
        },
        description: { type: "string", description: "One line describing what it does — dropped into the scaffolded README.md." },
      },
      required: ["id", "name"],
    },
  },
  {
    name: "list_plugins",
    description: "Lists every complemento visible in this project (its own project-scoped ones plus every global one), with id/name/scope/views/permissions, and whether its manifest is currently broken.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "reload_plugin",
    description:
      "Forces the desktop app to immediately re-read a complemento's files and refresh any open view of it. " +
      "Normally not needed — editing its files already triggers this automatically within a fraction of a " +
      "second — but useful right after scaffold_plugin if you want the sidebar to update with zero delay.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        scope: { type: "string", enum: ["project", "global"], description: "Defaults to \"project\"." },
      },
      required: ["id"],
    },
  },
  {
    name: "open_plugin",
    description: "Asks the desktop app to open (and switch the user to) a complemento, as a tab or a panel.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        scope: { type: "string", enum: ["project", "global"], description: "Defaults to \"project\"." },
        view: { type: "string", enum: ["tab", "panel"], description: "Defaults to the complemento's own defaultView." },
      },
      required: ["id"],
    },
  },
  {
    name: "read_plugin_api_docs",
    description:
      "Returns the full complemento API reference: the manifest.json schema, the window.ygg API available " +
      "inside a complemento's page (storage/fs/panes/gateway.call/app.*), its permission model, storage " +
      "semantics, hot reload behavior, and a worked example. Read this before writing a complemento's code — " +
      "the same text is also dropped into every scaffolded complemento's own README.md.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

function textResult(text: string, isError = false): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
  return { content: [{ type: "text", text }], isError };
}

type McpToolDef = { name: string; description: string; inputSchema: Record<string, unknown> };

/**
 * Resolves an MCP tool name (`<scope>-<id>__<tool>`) back to the plugin it
 * came from — rebuilt on every `tools/list` call (right before Claude Code
 * actually asks, not proactively watched), since a plugin's own declared
 * tools can change (edited, published, unpublished) between one list and
 * the next.
 */
let dynamicToolMap = new Map<string, { scope: string; id: string; tool: string }>();

/**
 * Every published complemento's own declared tools, fetched fresh each
 * `tools/list` from GET /plugins/tools (paneControlServer.ts — already
 * scope-filters to published plugins). `${scope}-${id}` (not just `id`)
 * keeps a project-scope and a global-scope plugin that happen to share an
 * id from colliding on the same MCP tool name.
 */
async function listDynamicTools(): Promise<McpToolDef[]> {
  const body = await callControl("/plugins/tools");
  const entries = Array.isArray(body.tools) ? (body.tools as Array<Record<string, unknown>>) : [];
  const next = new Map<string, { scope: string; id: string; tool: string }>();
  const mcpTools: McpToolDef[] = [];
  for (const entry of entries) {
    const scope = typeof entry.scope === "string" ? entry.scope : "project";
    const id = typeof entry.id === "string" ? entry.id : "";
    const pluginName = typeof entry.pluginName === "string" ? entry.pluginName : id;
    const tool = entry.tool as { name?: unknown; description?: unknown; inputSchema?: unknown } | undefined;
    if (!id || !tool || typeof tool.name !== "string" || typeof tool.description !== "string") continue;
    const mcpName = `${scope}-${id}__${tool.name}`;
    next.set(mcpName, { scope, id, tool: tool.name });
    mcpTools.push({
      name: mcpName,
      description: `[complemento ${pluginName}] ${tool.description}`,
      inputSchema:
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? (tool.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {}, required: [] },
    });
  }
  dynamicToolMap = next;
  return mcpTools;
}

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "scaffold_plugin": {
      const body = await callControl("/plugins/scaffold", { method: "POST", body: JSON.stringify(args) });
      return textResult(JSON.stringify(body, null, 2));
    }
    case "list_plugins": {
      const body = await callControl("/plugins");
      return textResult(JSON.stringify(body.plugins ?? [], null, 2));
    }
    case "reload_plugin": {
      const { id, scope } = args as { id?: string; scope?: string };
      if (!id) return textResult("reload_plugin: id is required", true);
      await callControl(`/plugins/${encodeURIComponent(scope === "global" ? "global" : "project")}/${encodeURIComponent(id)}/reload`, {
        method: "POST",
        body: "{}",
      });
      return textResult("ok");
    }
    case "open_plugin": {
      const { id, scope, view } = args as { id?: string; scope?: string; view?: string };
      if (!id) return textResult("open_plugin: id is required", true);
      await callControl(`/plugins/${encodeURIComponent(scope === "global" ? "global" : "project")}/${encodeURIComponent(id)}/open`, {
        method: "POST",
        body: JSON.stringify(view ? { view } : {}),
      });
      return textResult("ok");
    }
    case "read_plugin_api_docs": {
      const body = await callControl("/plugins/api-docs");
      return textResult(typeof body.markdown === "string" ? body.markdown : "");
    }
    default: {
      // Not one of the 5 static tools above — check whether it's a
      // dynamically-discovered complemento tool (see listDynamicTools,
      // called on the most recent tools/list). Unknown otherwise.
      const target = dynamicToolMap.get(name);
      if (!target) return textResult(`Unknown tool "${name}"`, true);
      const body = await callControl(`/plugins/${encodeURIComponent(target.scope)}/${encodeURIComponent(target.id)}/call-tool`, {
        method: "POST",
        body: JSON.stringify({ tool: target.tool, params: args }),
      });
      return textResult(JSON.stringify(body.result ?? null, null, 2));
    }
  }
}

function send(msg: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handle(msg: JsonRpcMessage): Promise<void> {
  const { id, method, params } = msg;

  // Notifications (no id) never get a response, by spec.
  if (id === undefined) return;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: (params?.protocolVersion as string) ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "yggdrasil-plugins-control", version: "0.1.0" },
      },
    });
    return;
  }

  if (method === "tools/list") {
    const dynamic = await listDynamicTools().catch((err) => {
      logError("failed to fetch dynamic plugin tools", err);
      return [];
    });
    send({ jsonrpc: "2.0", id, result: { tools: [...TOOLS, ...dynamic] } });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name as string;
    const args = (params?.arguments as Record<string, unknown>) ?? {};
    try {
      send({ jsonrpc: "2.0", id, result: await callTool(name, args) });
    } catch (err) {
      send({ jsonrpc: "2.0", id, result: textResult(err instanceof Error ? err.message : String(err), true) });
    }
    return;
  }

  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: JsonRpcMessage;
  try {
    msg = JSON.parse(trimmed) as JsonRpcMessage;
  } catch {
    return;
  }
  void handle(msg).catch((err) => logError("unhandled error", err));
});

process.stdin.resume();
