// Cross-project reads: the desktop's project list and each project's sessions and Agent Flow, read off disk.
// projects.create is the exception: it asks the Electron main process through the pane-control bridge.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionStore as SessionStoreClass } from "@yggdrasil/sessions";
import type { GatewayMethodHandler } from "./methods.js";

// Mirrors app-desktop/src/main/projects.ts's ProjectRecord — duplicated
// deliberately (same convention the repo already uses between renderer and
// main) since this package can't import Electron-main-only code.
type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastOpenedAt: number;
};

export interface ProjectMethodsDeps {
  register: (name: string, handler: GatewayMethodHandler) => void;
}

export function registerProjectMethods(deps: ProjectMethodsDeps): void {
  const { register } = deps;

  // The desktop app's project registry (app-desktop/src/main/projects.ts)
  // lives in Electron's main process and userData dir, unreachable from this
  // plain Node subprocess — Electron passes us the resolved file path via
  // YGGDRASIL_PROJECTS_FILE at spawn time (see main/gateway.ts) instead.
  register("projects.list", async () => {
    const projectsFile = process.env.YGGDRASIL_PROJECTS_FILE;
    if (!projectsFile) return { projects: [] };
    let projects: ProjectRecord[];
    try {
      projects = JSON.parse(await readFile(projectsFile, "utf8")) as ProjectRecord[];
    } catch {
      return { projects: [] };
    }

    // Merges in which projects are open right now and on what port
    // (main/openGateways.ts) — lets a mobile client connect straight to the
    // right project's own gateway (for terminals.list) instead of guessing.
    let openGateways: Record<string, { port: number }> = {};
    const openGatewaysFile = process.env.YGGDRASIL_OPEN_GATEWAYS_FILE;
    if (openGatewaysFile) {
      try {
        openGateways = JSON.parse(await readFile(openGatewaysFile, "utf8")) as Record<string, { port: number }>;
      } catch {
        // No registry yet (fresh install) or a transient write race — treat
        // as "nothing open", same as an empty file.
      }
    }

    const enriched = projects.map((p) => {
      const open = openGateways[p.id];
      return { ...p, isOpen: !!open, gatewayPort: open?.port };
    });
    return { projects: enriched.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt) };
  });

  // Creates a project folder on this computer (~/Yggdrasil/<name>) and opens
  // it. The project registry and windows live in Electron's main process, so
  // this bridges to its pane-control server like terminals.* does.
  register("projects.create", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) throw new Error("projects.create: only available on a desktop gateway");
    const res = await fetch(`${url}/projects/create`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: String(params.name ?? "") }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `projects.create failed (${res.status})`);
    return body;
  });

  // Lets a mobile client compare "which project is this?" against the
  // ProjectRecord it already has from projects.list, to know whether this
  // gateway is the one actually backing that project right now (only that
  // one has live data for terminals.list — every other project's gateway
  // isn't running at all).
  register("workspace.info", async (_params, ctx) => ({
    workspaceRoot: ctx.workspaceRoot ?? null,
  }));

  // Cross-project session reads — unlike sessions.list/sessions.get (scoped
  // to THIS gateway's own ctx.sessionStore), these take an explicit
  // projectPath and read that project's session files directly off disk via
  // a throwaway SessionStore, bypassing the process-wide getSessionStore()
  // singleton entirely. Works whether or not that project's own gateway is
  // currently running — session files are plain JSON with no live-process
  // dependency (packages/sessions/src/store.ts).
  const PROJECT_SESSION_MAX_MESSAGES = 500;

  register("projects.sessions.list", async (params) => {
    const projectPath = String(params.projectPath ?? "");
    if (!projectPath) throw new Error("projectPath required");
    const store = new SessionStoreClass(join(projectPath, ".yggdrasil", "sessions"), PROJECT_SESSION_MAX_MESSAGES);
    const sessions = await store.list();
    return { sessions };
  });

  register("projects.sessions.get", async (params) => {
    const projectPath = String(params.projectPath ?? "");
    const sessionKey = String(params.sessionKey ?? "");
    if (!projectPath) throw new Error("projectPath required");
    if (!sessionKey) throw new Error("sessionKey required");
    const store = new SessionStoreClass(join(projectPath, ".yggdrasil", "sessions"), PROJECT_SESSION_MAX_MESSAGES);
    const session = await store.get(sessionKey);
    return { session };
  });

  // Static Agent Flow config for a project — mirrors app-desktop's
  // readAgentFlow (main/agentFlow.ts), reimplemented here as a direct file
  // read since that module is Electron-main-only (can't be imported from
  // this package). "Is it currently running" is live, in-process state on
  // that project's own gateway — out of scope here, this only returns the
  // saved shape.
  register("projects.agentFlow.get", async (params) => {
    const projectPath = String(params.projectPath ?? "");
    if (!projectPath) throw new Error("projectPath required");
    try {
      const raw = await readFile(join(projectPath, "agent-flow.json"), "utf8");
      return { agentFlow: JSON.parse(raw) };
    } catch {
      return { agentFlow: null };
    }
  });

  // Agent Teams — named, saved node snapshots (main/agentTeams.ts), a
  // DIFFERENT concept from the single agent-flow.json canvas above (no
  // supervisor, lighter edges) but shown in the same "Agent Flow" screen on
  // desktop (AgentFlowView.tsx's "Open Team ▾"/"Save as Team…") — a project
  // can have real Teams with no saved canvas flow at all, so this needs to
  // be checked separately rather than assumed empty when agentFlow is null.
  register("projects.agentTeams.list", async (params) => {
    const projectPath = String(params.projectPath ?? "");
    if (!projectPath) throw new Error("projectPath required");
    try {
      const raw = await readFile(join(projectPath, "agent-teams.json"), "utf8");
      const parsed = JSON.parse(raw) as { teams?: unknown[] };
      return { teams: parsed.teams ?? [] };
    } catch {
      return { teams: [] };
    }
  });
}
