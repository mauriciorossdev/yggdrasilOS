import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ipcMain, type WebContents } from "electron";
import { readSettingsFile, updateSettingsFile } from "../settingsFile.js";
import { openChannel } from "./channels.js";
import { createLspManager } from "./manager.js";
import { findOnPath, LSP_SERVERS, serverStatus, serversForLanguage, type ServerContext, type ServerStatus } from "./servers.js";

const require = createRequire(import.meta.url);
// TypeScript's own lib.dom.d.ts alone is over 2 MB.
const MAX_EXTERNAL_FILE_BYTES = 8_000_000;

export type LspProject = { id: string; root: string; webContents: WebContents };

export type LspSessionInfo = {
  sessionId: string;
  serverId: string;
  languages: string[];
  rootUri: string;
  initializationOptions?: unknown;
  settings?: unknown;
};

function bundled(specifier: string): string | null {
  try {
    return require.resolve(specifier);
  } catch {
    return null;
  }
}

async function loadTrusted(userDataDir: string): Promise<string[]> {
  const raw = (await readSettingsFile(userDataDir)) as { lspTrustedProjects?: unknown };
  return Array.isArray(raw.lspTrustedProjects) ? raw.lspTrustedProjects.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Language servers run here, over Electron IPC, and not as gateway methods: the gateway is reachable
 * from paired phones and the LAN, where spawning servers would amount to remote code execution. The
 * project always comes from the calling window, never from what the renderer says.
 */
export function installLspIpc(opts: { userDataDir: string; projectForSender: (sender: WebContents) => LspProject | undefined }) {
  const owners = new Map<string, WebContents>();
  /** Which server each session runs, and why a server last stopped, for Settings. */
  const sessionServers = new Map<string, string>();
  const failures = new Map<string, string>();
  const failureKey = (projectId: string, serverId: string) => `${projectId}:${serverId}`;
  const send = (ownerId: string, channel: string, payload: unknown) => {
    const target = owners.get(ownerId);
    if (target && !target.isDestroyed()) target.send(channel, payload);
  };
  const manager = createLspManager({
    onMessage: (ownerId, sessionId, message) => send(ownerId, "lsp:message", { sessionId, message }),
    onClose: (ownerId, sessionId, reason) => {
      const serverId = sessionServers.get(sessionId);
      sessionServers.delete(sessionId);
      if (serverId && reason) failures.set(failureKey(ownerId, serverId), reason);
      send(ownerId, "lsp:closed", { sessionId, reason });
    },
  });

  const context = async (project: LspProject): Promise<ServerContext> => ({
    root: project.root,
    trusted: (await loadTrusted(opts.userDataDir)).includes(project.id),
    exists: existsSync,
    bundled,
    onPath: (command) => findOnPath(command, existsSync),
  });
  const projectOf = (sender: WebContents): LspProject => {
    const project = opts.projectForSender(sender);
    if (!project) throw new Error("lsp: not a project window");
    owners.set(project.id, project.webContents);
    return project;
  };

  ipcMain.handle("lsp:start", async (event, language: string): Promise<LspSessionInfo[]> => {
    const project = projectOf(event.sender);
    const ctx = await context(project);
    const rootUri = pathToFileURL(project.root).toString();
    const sessions: LspSessionInfo[] = [];
    for (const spec of serversForLanguage(language, ctx)) {
      const resolved = spec.resolve(ctx);
      if (!resolved) continue;
      const sessionId = manager.start(project.id, spec.id, () => openChannel(resolved.launch, project.root));
      sessionServers.set(sessionId, spec.id);
      sessions.push({
        sessionId,
        serverId: spec.id,
        languages: spec.languages,
        rootUri,
        initializationOptions: resolved.initializationOptions,
        settings: resolved.settings,
      });
    }
    return sessions;
  });

  ipcMain.on("lsp:send", (event, sessionId: string, message: unknown) => {
    const project = opts.projectForSender(event.sender);
    if (!project) return;
    try {
      manager.send(project.id, sessionId, message);
    } catch (err) {
      console.error("[lsp] send failed:", err);
    }
  });

  ipcMain.handle("lsp:status", async (event): Promise<{ trusted: boolean; servers: Array<{ id: string; languages: string[]; status: ServerStatus | "running"; installHint?: string; error?: string }> }> => {
    const project = projectOf(event.sender);
    const ctx = await context(project);
    const running = new Set(manager.runningServers(project.id));
    return {
      trusted: ctx.trusted,
      servers: LSP_SERVERS.map((spec) => ({
        id: spec.id,
        languages: spec.languages,
        status: running.has(spec.id) ? "running" : serverStatus(spec, ctx),
        installHint: spec.installHint,
        error: running.has(spec.id) ? undefined : failures.get(failureKey(project.id, spec.id)),
      })),
    };
  });

  // Changing trust restarts this project's servers, so nothing keeps running under the old decision.
  ipcMain.handle("lsp:setTrusted", async (event, trusted: boolean): Promise<void> => {
    const project = projectOf(event.sender);
    await updateSettingsFile(opts.userDataDir, (existing) => {
      const current = (existing as { lspTrustedProjects?: unknown }).lspTrustedProjects;
      const others = (Array.isArray(current) ? current : []).filter((id) => id !== project.id);
      return { ...existing, lspTrustedProjects: trusted === true ? [...others, project.id] : others };
    });
    await manager.stopOwner(project.id);
    for (const key of failures.keys()) {
      if (key.startsWith(`${project.id}:`)) failures.delete(key);
    }
    send(project.id, "lsp:trustChanged", { trusted: trusted === true });
  });

  /** A file a server pointed at outside the project (a library's types): read-only, only those. */
  ipcMain.handle("lsp:readExternal", async (event, uri: string): Promise<string | null> => {
    const project = projectOf(event.sender);
    if (typeof uri !== "string" || !uri.startsWith("file:") || !manager.isAllowedUri(project.id, uri)) return null;
    const path = fileURLToPath(uri);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size > MAX_EXTERNAL_FILE_BYTES) return null;
    return readFile(path, "utf8");
  });

  return {
    stopProject: (projectId: string) => manager.stopOwner(projectId).finally(() => owners.delete(projectId)),
    stopAll: () => manager.stopAll(),
  };
}
