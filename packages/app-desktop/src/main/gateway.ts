import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { access, readFile, writeFile } from "node:fs/promises";
import { logCaughtError } from "./crashLogging.js";

const require = createRequire(import.meta.url);

// Electron's own address for talking to its child gateway process (probe,
// getFreePort, the URL handed to the renderer) — always loopback, since
// Electron and the gateway subprocess are the same machine no matter what
// the gateway itself binds to. Do NOT change this to open the gateway up to
// Tailscale/LAN — that's GATEWAY_BIND_HOST below, a completely different
// concern (what the *server* listens on, not what Electron connects to).
const HOST = "127.0.0.1";

// What the gateway subprocess itself binds to — "0.0.0.0" covers loopback
// (what HOST above still uses to reach it) + LAN + Tailscale (which presents
// to the OS as just another network interface) with a single listen(), no
// second bind/listener needed (remote-access-analysis.md §7.4). Threaded
// into the child via YGGDRASIL_GATEWAY_HOST, same convention as
// YGGDRASIL_GATEWAY_PORT below — overrides config.gateway.host for this
// subprocess without touching the project's yggdrasil.config.json.
const GATEWAY_BIND_HOST = "0.0.0.0";
const PROBE_TIMEOUT_MS = 800;
const BOOT_TIMEOUT_MS = 15_000;
const BOOT_POLL_INTERVAL_MS = 300;

export type GatewayHandle = {
  url: string;
  /** Same host:port as `url`, but with the machine's own LAN address instead of loopback — for showing the human what to type into a phone (window title, Settings), never for Electron's own connection. */
  lanUrl: string;
  port: number;
  shutdown: () => void;
};

/**
 * The machine's own LAN-reachable IPv4 address — first non-internal
 * interface found (Wi-Fi/Ethernet), matching how the gateway subprocess
 * already binds (GATEWAY_BIND_HOST "0.0.0.0" covers this same address).
 * Purely for display (window title, Settings "Gateway:" line) so a human can
 * type it into a phone — falls back to loopback if no LAN interface is up
 * (e.g. offline), which is at least honestly non-functional rather than a
 * crash.
 */
export function getLanAddress(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return HOST;
}

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

/**
 * Asks the OS for a free port by briefly binding to port 0. There's a small
 * window between this closing and the gateway subprocess binding the same
 * port where another process could steal it — acceptable for a localhost
 * dev-desktop-app use case, same tradeoff the `get-port` package makes.
 */
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
 * pnpm gives every workspace package its own isolated node_modules — the
 * only directory guaranteed to contain a symlink for each @yggdrasil/*
 * plugin package this app depends on (provider-ollama, harness-llm, ...) is
 * *this* package's own node_modules/@yggdrasil. Each project's gateway
 * subprocess runs with YGGDRASIL_WORKSPACE pointed at that project's own
 * folder, which has no packages/ or node_modules of its own — so plugin
 * discovery needs to be told about this directory explicitly via
 * plugins.load.paths.
 *
 * Only seeds the config if none exists yet; never overwrites a config the
 * user (or an earlier run) already wrote — that's how agent/provider
 * settings persist across restarts, and how a folder that's already a
 * yggdrasil project (or has its own config) is left alone.
 *
 * Also seeds `sessions.dir` scoped inside the project folder. Without this,
 * `@yggdrasil/sessions`'s `createSessionStore` falls back to a single
 * *global* `~/.yggdrasil/sessions` for every workspace that doesn't set it
 * explicitly — every project would silently share one session store instead
 * of each having its own. Confirmed with a throwaway two-gateway script
 * before this fix: agents were correctly isolated per project (they live in
 * each project's own config file), but sessions were not.
 */
async function seedWorkspaceConfig(workspaceRoot: string, pluginSearchDir: string): Promise<void> {
  const configPath = join(workspaceRoot, "yggdrasil.config.json");

  if (!(await fileExists(configPath))) {
    const seed = {
      plugins: {
        load: {
          paths: [pluginSearchDir],
        },
      },
      sessions: {
        dir: join(workspaceRoot, ".yggdrasil", "sessions"),
      },
    };
    await writeFile(configPath, JSON.stringify(seed, null, 2), "utf8");
    return;
  }

  // A project opened before app-desktop bundled a given plugin has a config
  // that predates this path — its own node_modules was never going to have
  // that plugin either way, so without
  // this the gateway would never discover it no matter how many new
  // plugins app-desktop later bundles. Patch it in idempotently, leaving
  // every other field (agents, providers, existing search paths, ...)
  // untouched.
  try {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as {
      plugins?: { load?: { paths?: string[] } };
      [key: string]: unknown;
    };
    const existingPaths = raw.plugins?.load?.paths ?? [];
    if (existingPaths.includes(pluginSearchDir)) return;

    raw.plugins = { ...raw.plugins, load: { ...raw.plugins?.load, paths: [...existingPaths, pluginSearchDir] } };
    await writeFile(configPath, JSON.stringify(raw, null, 2), "utf8");
  } catch {
    // Malformed/unreadable config — leave it alone rather than risk
    // clobbering something the user hand-edited.
  }
}

function spawnGatewaySubprocess(
  workspaceRoot: string,
  port: number,
  projectsFile: string,
  paneControlUrl: string,
  paneControlToken: string,
  openGatewaysFile: string,
  workflowStateDir: string,
  desktopSettingsPath: string,
  auth?: { apiKey: string },
): ChildProcess {
  // Resolve @yggdrasil/cli's built entry point and run it under Electron's
  // own bundled Node (ELECTRON_RUN_AS_NODE) so no external Node install is
  // required — same approach any Electron app uses to run a Node sidecar.
  const cliEntry = require.resolve("@yggdrasil/cli");

  const child = spawn(process.execPath, [cliEntry, "gateway"], {
    // tool-system's file/shell tools (read_file, list_directory, run_command
    // with no explicit cwd, ...) resolve relative paths against process.cwd()
    // with no other base-path logic — without this, they'd resolve against
    // Electron's own directory instead of the project.
    cwd: workspaceRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      YGGDRASIL_WORKSPACE: workspaceRoot,
      YGGDRASIL_GATEWAY_PORT: String(port),
      YGGDRASIL_GATEWAY_HOST: GATEWAY_BIND_HOST,
      // Lets the "projects.list" RPC method read Electron's project registry
      // (main/projects.ts) even though this subprocess has no Electron `app`
      // API of its own to resolve the userData path itself.
      YGGDRASIL_PROJECTS_FILE: projectsFile,
      // Lets the "terminals.list" RPC method reach this same project's
      // pane-control HTTP server (main/paneControlServer.ts) — that server
      // lives in Electron's main process, not this subprocess, and is
      // loopback-only/token-authed, so both need to be handed across.
      YGGDRASIL_PANE_CONTROL_URL: paneControlUrl,
      YGGDRASIL_PANE_CONTROL_TOKEN: paneControlToken,
      // Lets "projects.list" report which OTHER projects are currently open
      // and on what port (main/openGateways.ts) — so a mobile client can
      // connect straight to the right project's own gateway instead of
      // guessing/hand-entering a port.
      YGGDRASIL_OPEN_GATEWAYS_FILE: openGatewaysFile,
      // extensions/service-workflows's WorkflowStore — always Electron's
      // userData, never the project's own repo (workflows-design.md §2.4).
      YGGDRASIL_WORKFLOW_STATE_DIR: workflowStateDir,
      // Read-only from this subprocess (extensions/service-workflows's kill
      // switch check) — only Electron main ever writes it, via
      // automationSettings.ts/settingsFile.ts.
      YGGDRASIL_DESKTOP_SETTINGS_PATH: desktopSettingsPath,
      // Phone link (main/phoneLink.ts): while this desktop is published to the
      // Railway hub, its gateways require a key from anything that isn't this
      // machine — this window keeps connecting over 127.0.0.1 without it.
      ...(auth ? { YGGDRASIL_API_KEY: auth.apiKey, YGGDRASIL_TRUST_LOOPBACK: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => console.log(`[gateway:${port}] ${chunk.toString().trimEnd()}`));
  child.stderr?.on("data", (chunk) => console.error(`[gateway:${port}] ${chunk.toString().trimEnd()}`));

  return child;
}

/**
 * Boots a dedicated gateway child process scoped to `workspaceRoot`, on a
 * freshly-allocated port. Every project window gets its own — separate OS
 * processes mean the kernel plugin registry and session-store globalThis
 * singletons (one per process) never collide between projects.
 */
export async function ensureGateway(
  workspaceRoot: string,
  pluginSearchDir: string,
  projectsFile: string,
  paneControlUrl: string,
  paneControlToken: string,
  openGatewaysFile: string,
  workflowStateDir: string,
  desktopSettingsPath: string,
  auth?: { apiKey: string },
): Promise<GatewayHandle> {
  const port = await getFreePort();
  const url = `ws://${HOST}:${port}`;

  await seedWorkspaceConfig(workspaceRoot, pluginSearchDir);
  const spawnChild = () =>
    spawnGatewaySubprocess(workspaceRoot, port, projectsFile, paneControlUrl, paneControlToken, openGatewaysFile, workflowStateDir, desktopSettingsPath, auth);
  let child = spawnChild();
  let stopping = false;
  const recentRestarts: number[] = [];

  // The renderer, phone link and open-gateways registry all hold this exact
  // port, so a gateway that dies on its own (uncaught exception, OOM kill) is
  // respawned on the SAME port — the renderer's gateway-client reconnects by
  // itself. Capped so a gateway that crashes on boot doesn't spin forever.
  const supervise = (c: ChildProcess): void => {
    let stderrTail = "";
    c.stderr?.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    c.once("exit", (code, signal) => {
      if (stopping) return;
      logCaughtError("gateway-exit", { port, workspaceRoot, code, signal, stderrTail });
      console.error(`[gateway:${port}] exited unexpectedly (code=${code} signal=${signal})`);
      const now = Date.now();
      while (recentRestarts.length > 0 && now - recentRestarts[0]! > 60_000) recentRestarts.shift();
      if (recentRestarts.length >= 5) {
        console.error(`[gateway:${port}] crashed 5 times in a minute — not restarting`);
        return;
      }
      recentRestarts.push(now);
      setTimeout(() => {
        if (stopping) return;
        child = spawnChild();
        supervise(child);
      }, 1000);
    });
  };
  supervise(child);

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
    stopping = true;
    child.kill();
    throw new Error(`Gateway did not become ready within ${BOOT_TIMEOUT_MS}ms`);
  }

  return {
    url,
    lanUrl: `ws://${getLanAddress()}:${port}`,
    port,
    shutdown: () => {
      stopping = true;
      child.kill();
    },
  };
}
