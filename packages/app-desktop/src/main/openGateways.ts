import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";

/**
 * Tiny registry of which projects currently have a live gateway (and on what
 * port) — written/removed by main/index.ts's openProject/window-closed
 * lifecycle, read by the gateway subprocess's own "projects.list" RPC method
 * (packages/gateway/src/methods.ts) via YGGDRASIL_OPEN_GATEWAYS_FILE, so a
 * mobile client can see, for each project, whether it's open right now and
 * which port to connect to for that project's own live data (terminals.list)
 * — instead of guessing/hand-entering the right port per project.
 */
export function openGatewaysPath(): string {
  return join(app.getPath("userData"), "open-gateways.json");
}

type OpenGatewaysFile = Record<string, { port: number }>;

async function readRegistry(): Promise<OpenGatewaysFile> {
  try {
    const raw = await readFile(openGatewaysPath(), "utf8");
    return JSON.parse(raw) as OpenGatewaysFile;
  } catch {
    return {};
  }
}

async function writeRegistry(registry: OpenGatewaysFile): Promise<void> {
  await mkdir(dirname(openGatewaysPath()), { recursive: true });
  await writeFile(openGatewaysPath(), JSON.stringify(registry, null, 2), "utf8");
}

/**
 * Every change is a read-modify-write of one file, so two at once (two windows booting together, e.g. a
 * deep link during launch) would lose one of them. They run one after another instead.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(op: () => Promise<T>): Promise<T> {
  const run = queue.then(op, op);
  queue = run.catch(() => {});
  return run;
}

/** Snapshot of the open project gateways (projectId -> port), for the phone link publisher. */
export function listOpenGateways(): Promise<OpenGatewaysFile> {
  return readRegistry();
}

export function registerOpenGateway(projectId: string, port: number): Promise<void> {
  return serialized(async () => {
    const registry = await readRegistry();
    registry[projectId] = { port };
    await writeRegistry(registry);
  });
}

export function unregisterOpenGateway(projectId: string): Promise<void> {
  return serialized(async () => {
    const registry = await readRegistry();
    if (!(projectId in registry)) return;
    delete registry[projectId];
    await writeRegistry(registry);
  });
}

/** Called once at app startup, before any project opens — a crash/force-quit
 * skips every window's "closed" cleanup, which would otherwise leave stale
 * entries pointing at ports nothing is listening on anymore. */
export function resetOpenGateways(): Promise<void> {
  return serialized(() => writeRegistry({}));
}
