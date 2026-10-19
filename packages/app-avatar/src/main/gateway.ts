import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { access, readFile, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);

const HOST = "127.0.0.1";
const PROBE_TIMEOUT_MS = 800;
const BOOT_TIMEOUT_MS = 15_000;
const BOOT_POLL_INTERVAL_MS = 300;

export type GatewayHandle = {
  url: string;
  port: number;
  shutdown: () => void;
};

async function probeGateway(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${HOST}:${port}/`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { service?: string };
    return body.service === "yggdrasil-gateway";
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Same free-port-probe tradeoff as app-desktop's gateway.ts — acceptable for a localhost single-instance desktop app. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const address = srv.address();
      if (address && typeof address === "object") {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("failed to allocate a free port"));
      }
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Seeds the app's own gateway workspace on first run only (never overwrites
 * an existing config, so provider/agent edits made via Settings persist
 * across restarts). Points plugin discovery at this package's own
 * node_modules/@yggdrasil (pnpm workspace symlinks), same reasoning as
 * app-desktop's seedWorkspaceConfig.
 *
 * tool-system (filesystem/shell) and tool-mcp are enabled — the renderer has
 * a tool-approval UI (ApprovalBar) for tool-system's destructive tools, but
 * `harness.toolApproval: "never"` skips it entirely so the agent can run
 * commands/write files unattended (explicit user tradeoff: real autonomy —
 * iterate, run tests, fix, retry — over a click-to-confirm safety net).
 * tool-weather stays disabled — it's just a demo/reference tool, not useful
 * here. maxToolIterations raised from the harness default (8) since an
 * iterate-until-it-works loop (run → read output → adjust → retry) often
 * needs more than 8 tool calls in one turn.
 *
 * Also seeds an MCP server entry for @playwright/mcp (real headless Chrome,
 * spawned via npx on first use) — gives the agent actual internet access
 * (search, read pages) with no API key needed, unlike most "web search"
 * options. --isolated keeps the browser profile in-memory only (no
 * persistent cookies/logins across runs, not needed for search).
 */
export type AvatarGatewayOptions = {
  systemPrompt: string;
  desktopShimPath: string;
  docsDir: string;
};

function desktopControlServer(options: AvatarGatewayOptions) {
  return {
    transport: "stdio" as const,
    command: process.execPath,
    args: [options.desktopShimPath],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      YGGDRASIL_AVATAR_DOCS_DIR: options.docsDir,
    },
  };
}

/** Keeps the app-owned parts of an existing config (avatar prompt, desktop-control server) current on every start. */
async function syncAvatarConfig(configPath: string, options: AvatarGatewayOptions): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as {
      agents?: Array<{ id?: string; systemPrompt?: string }>;
      mcpServers?: Record<string, unknown>;
    };
    let changed = false;
    const avatar = raw.agents?.find((agent) => agent.id === "avatar");
    if (avatar && avatar.systemPrompt !== options.systemPrompt) {
      avatar.systemPrompt = options.systemPrompt;
      changed = true;
    }
    const desktop = desktopControlServer(options);
    if (JSON.stringify(raw.mcpServers?.["desktop-control"]) !== JSON.stringify(desktop)) {
      raw.mcpServers = { ...raw.mcpServers, "desktop-control": desktop };
      changed = true;
    }
    if (changed) await writeFile(configPath, JSON.stringify(raw, null, 2), "utf8");
  } catch {
    // Malformed config: leave it alone rather than clobber a hand edit.
  }
}

async function seedWorkspaceConfig(
  workspaceRoot: string,
  pluginSearchDir: string,
  options: AvatarGatewayOptions,
): Promise<void> {
  const configPath = join(workspaceRoot, "yggdrasil.config.json");
  if (await fileExists(configPath)) {
    await syncAvatarConfig(configPath, options);
    return;
  }

  const seed = {
    plugins: {
      load: { paths: [pluginSearchDir] },
      disabled: ["tool-weather"],
    },
    sessions: {
      dir: join(workspaceRoot, "sessions"),
    },
    harness: {
      toolApproval: "never",
      maxToolIterations: 25,
    },
    agents: [
      {
        id: "avatar",
        label: "Avatar",
        provider: "openai-compat",
        model: "gpt-4o-mini",
        systemPrompt: options.systemPrompt,
      },
    ],
    defaultAgent: "avatar",
    mcpServers: {
      "desktop-control": desktopControlServer(options),
      playwright: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@playwright/mcp@latest", "--headless", "--browser", "chrome", "--isolated"],
      },
    },
  };
  await writeFile(configPath, JSON.stringify(seed, null, 2), "utf8");
}

function spawnGatewaySubprocess(workspaceRoot: string, port: number): ChildProcess {
  const cliEntry = require.resolve("@yggdrasil/cli");

  const child = spawn(process.execPath, [cliEntry, "gateway"], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      YGGDRASIL_WORKSPACE: workspaceRoot,
      YGGDRASIL_GATEWAY_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => console.log(`[gateway:${port}] ${chunk.toString().trimEnd()}`));
  child.stderr?.on("data", (chunk) => console.error(`[gateway:${port}] ${chunk.toString().trimEnd()}`));

  return child;
}

/** Boots a single gateway child process scoped to `workspaceRoot`, on a freshly-allocated port. One per app instance — no multi-window/multi-project concept in this app. */
export async function ensureGateway(
  workspaceRoot: string,
  pluginSearchDir: string,
  options: AvatarGatewayOptions,
): Promise<GatewayHandle> {
  const port = await getFreePort();
  const url = `ws://${HOST}:${port}`;

  await seedWorkspaceConfig(workspaceRoot, pluginSearchDir, options);
  const child = spawnGatewaySubprocess(workspaceRoot, port);

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let booted = false;
  while (Date.now() < deadline) {
    if (await probeGateway(port)) {
      booted = true;
      break;
    }
    await sleep(BOOT_POLL_INTERVAL_MS);
  }

  if (!booted) {
    child.kill();
    throw new Error(`Gateway did not become ready within ${BOOT_TIMEOUT_MS}ms`);
  }

  return {
    url,
    port,
    shutdown: () => {
      child.kill();
    },
  };
}
