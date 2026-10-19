import { createInterface } from "node:readline";
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

/**
 * Standalone MCP server (stdio), spawned by the avatar's gateway from its
 * mcpServers config. Lets the avatar start Yggdrasil Desktop, open a project
 * and call that project's gateway, the same way the mobile client does.
 * stdout is the JSON-RPC channel, so diagnostics go to stderr only.
 */

const DESKTOP_APP_BUNDLE = "/Applications/yggdrasil-desktop.app";
const DOCS_DIR = process.env.YGGDRASIL_AVATAR_DOCS_DIR ?? join(homedir(), "Documents", "yggdrasil-avatar");
const LAUNCH_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;

type Project = { id: string; name: string; path: string };
type OpenGateways = Record<string, { port: number }>;
type JsonRpcMessage = { id?: string | number; method: string; params?: Record<string, unknown> };

function logError(...args: unknown[]): void {
  console.error("[desktop-control-mcp]", ...args);
}

function desktopDataDir(): string {
  switch (platform()) {
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "@yggdrasil", "app-desktop");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "@yggdrasil", "app-desktop");
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "@yggdrasil", "app-desktop");
  }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function listProjects(): Promise<Project[]> {
  return readJson<Project[]>(join(desktopDataDir(), "projects.json"), []);
}

/** Registry entries whose gateway actually answers; a stale entry from a closed desktop is dropped. */
async function openGateways(): Promise<OpenGateways> {
  const registry = await readJson<OpenGateways>(join(desktopDataDir(), "open-gateways.json"), {});
  const live: OpenGateways = {};
  await Promise.all(
    Object.entries(registry).map(async ([projectId, entry]) => {
      try {
        const res = await fetch(`http://127.0.0.1:${entry.port}/`, { signal: AbortSignal.timeout(800) });
        const body = (await res.json()) as { service?: string };
        if (res.ok && body.service === "yggdrasil-gateway") live[projectId] = entry;
      } catch {
        // Not answering: the desktop closed without unregistering it.
      }
    }),
  );
  return live;
}

function isAppRunning(): Promise<boolean> {
  if (platform() !== "darwin") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("pgrep", ["-f", `${DESKTOP_APP_BUNDLE}/Contents/MacOS/`], (err) => resolve(!err));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGateway(projectId?: string): Promise<OpenGateways> {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const gateways = await openGateways();
    if (projectId ? gateways[projectId] : Object.keys(gateways).length > 0) return gateways;
    await sleep(500);
  }
  throw new Error(
    projectId
      ? `el proyecto ${projectId} no quedó abierto en ${LAUNCH_TIMEOUT_MS / 1000}s`
      : `la desktop no abrió ningún proyecto en ${LAUNCH_TIMEOUT_MS / 1000}s`,
  );
}

function openUrl(url: string): void {
  const [cmd, args] = platform() === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

async function ensureDesktopRunning(): Promise<string> {
  if (await isAppRunning()) return "ya estaba abierta";
  spawn("open", ["-a", DESKTOP_APP_BUNDLE], { detached: true, stdio: "ignore" }).unref();
  await waitForGateway();
  return "abierta ahora";
}

async function openProject(query: { projectId?: string; name?: string }): Promise<string> {
  const projects = await listProjects();
  const needle = query.name?.trim().toLowerCase();
  const project =
    projects.find((p) => p.id === query.projectId) ??
    (needle ? projects.find((p) => p.name.toLowerCase().includes(needle)) : undefined);
  if (!project) {
    const names = projects.map((p) => `${p.name} (${p.id})`).join(", ") || "ninguno";
    throw new Error(`no encontré ese proyecto. Proyectos disponibles: ${names}`);
  }
  const desktopState = await ensureDesktopRunning();
  openUrl(`yggdrasil://open-project?id=${encodeURIComponent(project.id)}`);
  await waitForGateway(project.id);
  return `Desktop ${desktopState}; proyecto "${project.name}" abierto.`;
}

function callGateway(port: number, method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`${method} superó el tiempo de espera`));
    }, CALL_TIMEOUT_MS);
    ws.on("open", () => ws.send(JSON.stringify({ id, method, params: params ?? {} })));
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data)) as { id?: string; result?: unknown; error?: { message?: string } };
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) reject(new Error(msg.error.message ?? "error del gateway"));
      else resolve(msg.result);
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function desktopCall(args: { method: string; params?: unknown; projectId?: string }): Promise<unknown> {
  const gateways = await openGateways();
  const projectId = args.projectId ?? Object.keys(gateways)[0];
  const entry = projectId ? gateways[projectId] : undefined;
  if (!entry) throw new Error("no hay ningún proyecto abierto en la desktop; usá desktop_open_project primero");
  return callGateway(entry.port, args.method, args.params);
}

function safeFileName(title: string): string {
  return (
    title
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 120) || "documento"
  );
}

async function writeDocument(args: { title: string; content: string; projectId?: string }): Promise<string> {
  let base = DOCS_DIR;
  if (args.projectId) {
    const project = (await listProjects()).find((p) => p.id === args.projectId);
    if (!project) throw new Error(`no existe el proyecto ${args.projectId}`);
    base = join(project.path, "notes");
  }
  await mkdir(base, { recursive: true });
  const file = join(base, `${safeFileName(args.title)}.md`);
  if (existsSync(file)) {
    throw new Error(`ya existe ${file}; preguntá al usuario antes de sobrescribirlo`);
  }
  await writeFile(file, args.content, "utf8");
  return `documento guardado en ${file}`;
}

const TOOLS = [
  {
    name: "desktop_status",
    description:
      "Says whether Yggdrasil Desktop is open and which projects are currently open in it (id and port). Call this before anything that needs the desktop.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const gateways = await openGateways();
      return JSON.stringify({ running: await isAppRunning(), openProjects: gateways }, null, 2);
    },
  },
  {
    name: "desktop_launch",
    description: "Opens Yggdrasil Desktop if it is not running and waits until a project is open in it.",
    inputSchema: { type: "object", properties: {} },
    run: async () => `Desktop ${await ensureDesktopRunning()}.`,
  },
  {
    name: "desktop_list_projects",
    description: "Lists every project known to Yggdrasil Desktop (id, name, path).",
    inputSchema: { type: "object", properties: {} },
    run: async () => JSON.stringify(await listProjects(), null, 2),
  },
  {
    name: "desktop_open_project",
    description:
      "Opens a Yggdrasil Desktop project by id or by name (partial, case-insensitive). Launches the desktop if needed.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, name: { type: "string" } },
    },
    run: async (args: { projectId?: string; name?: string }) => openProject(args),
  },
  {
    name: "desktop_call",
    description:
      "Calls any method of an open project's gateway over its WebSocket (the same API the desktop app and the mobile client use). Use it for documents, terminals, agents, projects and any other desktop feature. Requires the project to be open.",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string" },
        params: { type: "object" },
        projectId: { type: "string", description: "Open project to call. Defaults to the first open one." },
      },
      required: ["method"],
    },
    run: async (args: { method: string; params?: unknown; projectId?: string }) =>
      JSON.stringify(await desktopCall(args), null, 2),
  },
  {
    name: "open_on_screen",
    description:
      "Opens an app or a URL/file on the user's screen (macOS `open`). Use it for 'open Chrome', 'open google.com', 'open this folder'. The Playwright browser is headless and invisible to the user, so don't use it for that.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "App name, e.g. 'Google Chrome'." },
        target: { type: "string", description: "URL, file or folder to open, e.g. 'https://www.google.com'." },
      },
    },
    run: async (args: { app?: string; target?: string }) => {
      if (!args.app && !args.target) throw new Error("indicá app, target, o ambos");
      const openArgs = [...(args.app ? ["-a", args.app] : []), ...(args.target ? [args.target] : [])];
      await new Promise<void>((resolve, reject) => {
        execFile("open", openArgs, (err) => (err ? reject(err) : resolve()));
      });
      return `Abierto en pantalla: ${[args.app, args.target].filter(Boolean).join(" ")}`;
    },
  },
  {
    name: "desktop_write_document",
    description:
      "Writes a markdown document. With projectId it goes to that project's notes/ folder (its Documents tab). Without it, it goes to the avatar's own folder. Never overwrites: ask the user first if the file already exists.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        projectId: { type: "string" },
      },
      required: ["title", "content"],
    },
    run: async (args: { title: string; content: string; projectId?: string }) => writeDocument(args),
  },
];

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

async function handle(message: JsonRpcMessage): Promise<void> {
  if (message.id === undefined) return;
  const id = message.id;
  switch (message.method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "desktop-control", version: "0.1.0" },
        },
      });
      return;
    case "tools/list":
      send({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
      });
      return;
    case "tools/call": {
      const name = String(message.params?.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        send({ jsonrpc: "2.0", id, result: textResult(`Unknown tool "${name}"`, true) });
        return;
      }
      try {
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
        const text = await tool.run(args as never);
        send({ jsonrpc: "2.0", id, result: textResult(text) });
      } catch (err) {
        send({ jsonrpc: "2.0", id, result: textResult(err instanceof Error ? err.message : String(err), true) });
      }
      return;
    }
    default:
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try {
    void handle(JSON.parse(line) as JsonRpcMessage);
  } catch (err) {
    logError("bad JSON-RPC line", err);
  }
});
