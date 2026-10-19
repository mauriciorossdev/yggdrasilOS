import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrowserWindow } from "electron";
import {
  createTerminal,
  expandTerminalForMobile,
  findTerminalIdByPid,
  getFlowNodeId,
  listTerminals,
  readTerminalOutput,
  readTerminalOutputAtWidth,
  readTranscript,
  restoreTerminalNativeSize,
  terminalExists,
  writeToTerminal,
} from "./terminals.js";
import { readAgentTeams, recordAutoCapturedNode } from "./agentTeams.js";
import { composeSpecMessage, resolveSpecFile, SpecPathError } from "./paneSpec.js";
import type { PickedElement } from "./browserTabView.js";
import type { PluginRecord, PluginScope, PluginView, ScaffoldPluginSpec } from "./plugins.js";
import { getDesktopAutomationAdapter, PermissionRequiredError, type PermissionKind } from "./automation/index.js";

const execFileAsync = promisify(execFile);

/**
 * A `claude` pane's MCP shim reports its own `process.ppid` — but that's
 * only claude's own pid, one hop above the *pty's* tracked pid whenever
 * claude was started by a human typing `claude` inside a plain shell pane
 * (the pty's proc is the shell, claude is the shell's child, the shim is
 * claude's child — two hops from the tracked pid, not one). Walk up via
 * `ps` until a pid matches a tracked pane or the chain runs out. macOS/Linux
 * only (`ps -o ppid=` — same "accepted Windows gap" posture as terminals.ts's
 * other platform-specific bits); on win32 this just checks the given pid.
 */
async function findTerminalIdByPidAncestry(pid: number, maxHops = 6): Promise<string | undefined> {
  let current = pid;
  for (let hop = 0; hop <= maxHops; hop++) {
    const found = findTerminalIdByPid(current);
    if (found) return found;
    if (process.platform === "win32" || current <= 1) return undefined;
    try {
      const { stdout } = await execFileAsync("ps", ["-o", "ppid=", "-p", String(current)]);
      const parent = Number(stdout.trim());
      if (!Number.isFinite(parent) || parent === current) return undefined;
      current = parent;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export type PaneControlHandle = {
  url: string;
  token: string;
  shutdown: () => void;
  /** Latest Claude Code rate-limit sample reported via POST /statusline, if any yet — see getRateLimits below. */
  getRateLimits: () => RateLimitsPayload | undefined;
  /** Same listing as GET /panes — exposed directly so panes:list (IPC, for ygg.panes.list) and the plugins MCP shim don't need to go over this server's own loopback HTTP just to reach code running in this same process. */
  listPanes: () => Promise<{ panes: PaneSummary[] }>;
  /** Same as POST /panes — see createPane below. */
  createPane: (spec: CreatePaneSpec) => Promise<{ id: string }>;
  /** Same as POST /panes/:id/write — see writePane below. */
  writePane: (id: string, text: string, pressEnter: boolean, sourcePaneId?: string) => Promise<void>;
};

export type RateLimitWindow = { usedPercentage: number; resetsAt: number };
/** Mirrors renderer/src/types.ts's RateLimitsPayload — see statuslineBridge.ts for where these values come from. */
export type RateLimitsPayload = { fiveHour?: RateLimitWindow; sevenDay?: RateLimitWindow };

type PaneRecord = { id: string; title: string; cwd: string; createdAt: number; sessionKey?: string; command?: string };

/** Same shape as the internal PaneRecord — the merged (own registry + live terminals) listing GET /panes and listPanes() both return. */
export type PaneSummary = PaneRecord;

export type CreatePaneSpec = {
  cwd?: string;
  title?: string;
  command?: string;
  args?: string[];
  /** Becomes this pane's --append-system-prompt context (a "claude" pane only) — never a submitted prompt, see doCreatePane. */
  purpose?: string;
  /** The *live* renderer-side pane id of the caller, if any — lets TerminalContainer.tsx split the new pane next to its actual source and lets the auto-capture Team recording resolve a stable source node. */
  sourcePaneId?: string;
};

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;

// Comfortable-but-not-huge default width when a mobile client expands a
// pane without specifying its own cols/rows.
const MOBILE_EXPAND_COLS = 90;
const MOBILE_EXPAND_ROWS = 40;

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Local-only (127.0.0.1) HTTP API that the MCP stdio shim
 * (paneControlMcpShim.ts) proxies tool calls to, giving a `claude` pane's
 * agent a programmatic way to do what a human does with the Delegate button
 * (TerminalPane.tsx) or what `tmux send-keys`/`capture-pane` give it in a
 * bare terminal: spawn sibling panes, type into them, and read their output.
 *
 * Panes created here run in this process's `terminals` map (main/terminals.ts)
 * exactly like a UI-launched pane, AND get pushed into the renderer's pane
 * tree via a "pane:created" event — the renderer attaches to the already-live
 * pty (TerminalPane's `attach` leaf field) rather than spawning its own, so
 * the same process the agent is controlling is what's drawn on screen.
 *
 * createPane/writePane/listPanes below are also called directly (no HTTP
 * round trip) by main/index.ts's panes:* IPC handlers (a plugin's
 * ygg.panes.* calls, see pluginHost.ts). The /plugins/* routes below are the
 * plugins MCP shim's transport instead — same port/token as everything else
 * here, no second server, mirroring how documentsControlMcpShim.ts reuses
 * nothing while paneControlMcpShim.ts reuses this one.
 */
export async function startPaneControlServer(
  projectId: string,
  projectPath: string,
  getWindow: () => BrowserWindow | undefined,
  /** Operations on this project's Browser tab (main/index.ts's resolveBrowserTab), creating its WebContentsView on first use — kept as injected callbacks rather than importing browserTabView.js directly here, same reasoning as getWindow: the real project-window registry lives in main/index.ts, not this module. */
  browserTab: {
    navigate: (url: string) => Promise<void>;
    startPick: (timeoutMs?: number) => Promise<PickedElement | null>;
  },
  /** Backs the /plugins/* routes below (the plugins MCP shim's transport) — injected the same way as `browserTab` above, since the real plugin registry (plugins.ts) and project-window map live in main/index.ts, not this module. */
  plugins: {
    list: () => Promise<PluginRecord[]>;
    scaffold: (spec: ScaffoldPluginSpec) => Promise<PluginRecord>;
    /** Pushes plugins:changed to notify the UI immediately, ahead of the fs.watch debounce (which will also fire on its own). scope+id omitted means "rescan everything". */
    reload: (scope?: PluginScope, id?: string) => void;
    /** Pushes plugins:openRequest so this project's window opens/focuses the given plugin — see ChatView.tsx's onOpenRequest subscription. */
    open: (scope: PluginScope, id: string, view?: PluginView) => void;
    apiDocs: () => string;
    /** Dispatches to a published plugin's own ygg.tools.register handler — headless if it isn't currently open. Rejects on timeout/error; the caller (POST /plugins/:scope/:id/call-tool below) turns that into a 500. */
    callTool: (scope: PluginScope, id: string, tool: string, params: unknown) => Promise<unknown>;
  },
  /** Backs POST /projects/create (the gateway's projects.create, used by the phone) — injected for the same reason as `plugins`: the project registry and window map live in main/index.ts. Rejects with a user-facing message on bad/duplicate names. */
  projects?: {
    create: (name: string) => Promise<{ id: string; name: string; path: string; port: number | null }>;
  },
): Promise<PaneControlHandle> {
  const token = randomBytes(24).toString("hex");
  const panes = new Map<string, PaneRecord>();
  let latestRateLimits: RateLimitsPayload | undefined;

  async function doListPanes(): Promise<{ panes: PaneSummary[] }> {
    // `panes` (this server's own Map) only ever gets entries from THIS
    // server's own doCreatePane below — a Team reloaded via the ordinary
    // Terminal-tab hydration path never touches it, so on its own list_panes
    // would come back empty for every pane the caller didn't personally just
    // create_pane. Merge in every live terminal (terminals.ts's own
    // registry, populated on every pane creation regardless of how) so a
    // reloaded orchestrator can actually rediscover its (reloaded) team —
    // falling back to a team-node name lookup by flowNodeId
    // (agent-teams.json) for ones this server never saw a title for.
    const known = new Set(panes.keys());
    const extra = listTerminals().filter((t) => !known.has(t.id));
    let teamNodeNames: Map<string, string> | undefined;
    if (extra.length > 0) {
      const teams = await readAgentTeams(projectPath);
      teamNodeNames = new Map(teams.flatMap((t) => t.nodes.map((n) => [n.id, n.name] as const)));
    }
    const merged = [
      ...panes.values(),
      ...extra.map((t) => ({
        id: t.id,
        title: (t.flowNodeId && teamNodeNames?.get(t.flowNodeId)) || t.id,
        cwd: projectPath,
        createdAt: 0,
        sessionKey: t.sessionKey,
        command: t.command,
      })),
    ];
    return { panes: merged };
  }

  async function doCreatePane(spec: CreatePaneSpec): Promise<{ id: string }> {
    const id = randomUUID();
    const cwd = spec.cwd && spec.cwd.trim() ? spec.cwd : projectPath;
    const title = spec.title && spec.title.trim() ? spec.title : `agent-pane-${panes.size + 1}`;

    const command = spec.command;
    const rawArgs = spec.args;
    const purpose = spec.purpose && spec.purpose.trim() ? spec.purpose.trim() : undefined;
    const sourcePaneId = spec.sourcePaneId;

    // Server-enforced, not left to the calling agent's own judgment:
    // `purpose` always becomes this pane's --append-system-prompt context,
    // never a submitted prompt. Instantiating a pane must never trigger work
    // on its own — a submitted prompt (whether a bare positional or a
    // follow-up write_pane call right after creation) makes Claude Code
    // actually process a turn, which reads to the user as "it started
    // working" regardless of what the text says. Only an explicit later
    // write_pane (a real instruction, sent when there's actually one ready)
    // should do that — see the create_pane tool description in
    // paneControlMcpShim.ts.
    const args = command === "claude" && purpose ? [...(rawArgs ?? []), "--append-system-prompt", purpose] : rawArgs;

    createTerminal(
      { id, projectId, cwd, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, command, args },
      undefined,
      (chunk) => {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send("terminal:data", { id, chunk });
      },
      (exitCode) => {
        panes.delete(id);
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send("terminal:exit", { id, exitCode });
      },
    );
    panes.set(id, { id, title, cwd, createdAt: Date.now(), command });

    const win = getWindow();
    if (win && !win.isDestroyed()) {
      // sourcePaneId is the *live* renderer-side pane id of the caller (not
      // the stable flowNodeId substitution used below for Team bookkeeping)
      // — TerminalContainer.tsx needs it to split the new pane next to its
      // actual source rather than whatever pane happens to have UI focus.
      win.webContents.send("pane:created", { id, title, cwd, command, args, sourcePaneId });
    }

    // A stated purpose on a real `claude` pane is worth remembering — save
    // it into this project's auto-captured Team so it shows up next to
    // manually-designed ones, as context (its role/task is still recorded
    // and shown, e.g. in the Agent Flow canvas and the team-reload roster
    // note — just never auto-submitted as a prompt, see the args-building
    // comment above). Any other command has no AgentFlowHarness shape to
    // record itself as (only yggdrasil/claude/antigravity/omp/copilot
    // exist), so it's intentionally skipped.
    if (command === "claude" && purpose) {
      // Prefer the source pane's *stable* node id (carried on a reloaded
      // Team leaf as flowNodeId) over its fresh ephemeral pane id —
      // otherwise every reload of a saved Team would look like a brand-new
      // orchestrator here, splitting what should be one node's edges across
      // a growing set of look-alike duplicates.
      const source = sourcePaneId
        ? {
            id: getFlowNodeId(sourcePaneId) ?? sourcePaneId,
            name: panes.get(sourcePaneId)?.title ?? "Orchestrator",
          }
        : undefined;
      void recordAutoCapturedNode(projectPath, { id, name: title, initialPrompt: purpose }, source);
      // Live mirror for whichever Agent Flow canvas is open right now —
      // recordAutoCapturedNode above only persists to agent-teams.json,
      // invisible until the user manually reopens that team. This lets
      // AgentFlowView.tsx (if mounted) drop the new node + its edge from the
      // spawning node straight onto the canvas as it happens, same "role
      // becomes context, never an auto-submitted prompt" node shape
      // recordAutoCapturedNode's own upsertTeamNode builds.
      if (win && !win.isDestroyed()) {
        win.webContents.send("agentFlow:autoCapture", {
          node: { id, name: title, initialPrompt: purpose },
          source,
        });
      }
    }

    return { id };
  }

  async function doWritePane(id: string, text: string, pressEnter: boolean, sourcePaneId?: string): Promise<void> {
    if (!terminalExists(id)) throw new Error("unknown pane id");
    writeToTerminal(id, text);
    if (pressEnter) {
      // A composer (Claude Code's included) can't tell a burst of
      // `text + "\r"` written in one shot apart from a multi-line paste — it
      // inserts the \r as a literal newline instead of submitting, same as
      // pasting multi-line text never auto-submits for a human either.
      // Sending Enter as its own write, after the text has had a moment to
      // land, makes it read as a genuinely separate keystroke.
      setTimeout(() => writeToTerminal(id, "\r"), 80);
    }

    // Live "who's talking to whom" pulse for AgentFlowCanvas — same stable-
    // flowNodeId resolution as doCreatePane's own sourcePaneId handling
    // above, so this lines up with whatever AgentFlowEdge.from/.to values
    // are actually on the canvas (ephemeral pane ids only match right after
    // creation, never across a reload).
    if (sourcePaneId) {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("agentFlow:communication", {
          from: getFlowNodeId(sourcePaneId) ?? sourcePaneId,
          to: getFlowNodeId(id) ?? id,
        });
      }
    }
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${token}`) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "GET" && parts.length === 1 && parts[0] === "whoami") {
        // Lets a shim self-identify via process ancestry (its own
        // process.ppid) rather than an env var, whose survival through the
        // `claude` CLI's own MCP-server spawn is unverified — see
        // terminals.ts's findTerminalIdByPid for why this is more reliable.
        const pid = Number(url.searchParams.get("pid"));
        const paneId = Number.isFinite(pid) ? await findTerminalIdByPidAncestry(pid) : undefined;
        if (!paneId) {
          sendJson(res, 404, { error: "no pane found for that pid" });
          return;
        }
        sendJson(res, 200, { paneId, title: panes.get(paneId)?.title });
        return;
      }

      if (req.method === "POST" && parts.length === 2 && parts[0] === "projects" && parts[1] === "create") {
        if (!projects) {
          sendJson(res, 501, { error: "project creation not available" });
          return;
        }
        const body = await readJsonBody(req);
        try {
          sendJson(res, 200, await projects.create(typeof body.name === "string" ? body.name : ""));
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : "could not create project" });
        }
        return;
      }

      if (req.method === "GET" && parts.length === 1 && parts[0] === "panes") {
        sendJson(res, 200, await doListPanes());
        return;
      }

      if (req.method === "POST" && parts.length === 1 && parts[0] === "panes") {
        const body = await readJsonBody(req);
        const result = await doCreatePane({
          cwd: typeof body.cwd === "string" ? body.cwd : undefined,
          title: typeof body.title === "string" ? body.title : undefined,
          command: typeof body.command === "string" ? body.command : undefined,
          args: Array.isArray(body.args) ? body.args.map(String) : undefined,
          purpose: typeof body.purpose === "string" ? body.purpose : undefined,
          sourcePaneId: typeof body.sourcePaneId === "string" ? body.sourcePaneId : undefined,
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && parts.length === 3 && parts[0] === "panes" && parts[2] === "write") {
        const id = parts[1]!;
        const body = await readJsonBody(req);
        let text = typeof body.text === "string" ? body.text : "";
        let specRelativePath: string | null = null;
        const pressEnter = body.pressEnter !== false;
        const sourcePaneId = typeof body.sourcePaneId === "string" ? body.sourcePaneId : undefined;
        // specPath: hand the worker a feature doc by reference. Validated
        // before anything is written so a bad path never reaches the pty (and
        // isn't mistaken for the 404 below).
        if (typeof body.specPath === "string" && body.specPath.trim()) {
          try {
            const { absolutePath, projectRelativePath } = await resolveSpecFile(projectPath, body.specPath);
            text = composeSpecMessage(absolutePath, text);
            specRelativePath = projectRelativePath;
          } catch (err) {
            if (!(err instanceof SpecPathError)) throw err;
            sendJson(res, 400, { error: err.message });
            return;
          }
        } else if (typeof body.text !== "string") {
          sendJson(res, 400, { error: "write_pane needs `text` or `specPath`" });
          return;
        }
        try {
          await doWritePane(id, text, pressEnter, sourcePaneId);
        } catch (err) {
          sendJson(res, 404, { error: err instanceof Error ? err.message : "unknown pane id" });
          return;
        }
        // Tell the renderer which feature doc this pane now works from, so its
        // header can show the doc's status (see terminal/usePaneSpec.ts).
        if (specRelativePath) {
          const win = getWindow();
          if (win && !win.isDestroyed()) win.webContents.send("pane:spec", { paneId: id, specPath: specRelativePath });
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && parts.length === 1 && parts[0] === "statusline") {
        // Posted by statuslineBridge.ts on every Claude Code status tick,
        // from whichever `claude` pane happens to be running in this
        // project — the rate limit itself is account-wide, not per-pane, so
        // the most recent sample from any pane is exactly "current".
        const body = await readJsonBody(req);
        const rateLimits = body as RateLimitsPayload;
        if (rateLimits.fiveHour || rateLimits.sevenDay) {
          latestRateLimits = rateLimits;
          const win = getWindow();
          if (win && !win.isDestroyed()) win.webContents.send("statusline:update", rateLimits);
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && parts.length === 3 && parts[0] === "panes" && parts[2] === "read") {
        const id = parts[1]!;
        if (!terminalExists(id)) {
          sendJson(res, 404, { error: "unknown pane id" });
          return;
        }
        const maxChars = Number(url.searchParams.get("maxChars") ?? "4000") || 4000;
        // Optional — a mobile client asks for its own narrower width so long
        // lines reflow to its screen instead of whatever the desktop pane's
        // actual pty columns happen to be right now (see terminals.ts's
        // mobileTerm/readTerminalOutputAtWidth — never touches the real pty).
        const colsParam = url.searchParams.get("cols");
        const cols = colsParam ? Number(colsParam) : undefined;
        const text =
          cols && Number.isFinite(cols) && cols > 0
            ? readTerminalOutputAtWidth(id, cols, maxChars)
            : readTerminalOutput(id, maxChars);
        sendJson(res, 200, { text: text ?? "" });
        return;
      }

      if (req.method === "GET" && parts.length === 3 && parts[0] === "panes" && parts[2] === "transcript") {
        const id = parts[1]!;
        if (!terminalExists(id)) {
          sendJson(res, 404, { error: "unknown pane id" });
          return;
        }
        const { available, messages } = await readTranscript(id);
        sendJson(res, 200, { available, messages });
        return;
      }

      if (req.method === "POST" && parts.length === 3 && parts[0] === "panes" && parts[2] === "expand") {
        const id = parts[1]!;
        if (!terminalExists(id)) {
          sendJson(res, 404, { error: "unknown pane id" });
          return;
        }
        const body = await readJsonBody(req);
        const cols = Number(body.cols ?? MOBILE_EXPAND_COLS) || MOBILE_EXPAND_COLS;
        const rows = Number(body.rows ?? MOBILE_EXPAND_ROWS) || MOBILE_EXPAND_ROWS;
        const becameFocused = expandTerminalForMobile(id, cols, rows);
        if (becameFocused) {
          const win = getWindow();
          if (win && !win.isDestroyed()) win.webContents.send("pane:mobileFocus", { id, active: true });
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && parts.length === 3 && parts[0] === "panes" && parts[2] === "restore") {
        const id = parts[1]!;
        if (!terminalExists(id)) {
          sendJson(res, 404, { error: "unknown pane id" });
          return;
        }
        const becameIdle = restoreTerminalNativeSize(id);
        if (becameIdle) {
          const win = getWindow();
          if (win && !win.isDestroyed()) win.webContents.send("pane:mobileFocus", { id, active: false });
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && parts.length === 2 && parts[0] === "browser" && parts[1] === "open") {
        const body = await readJsonBody(req);
        const url = typeof body.url === "string" ? body.url : "";
        if (!url.trim()) {
          sendJson(res, 400, { error: "url is required" });
          return;
        }
        await browserTab.navigate(url);
        // Navigating alone doesn't switch the renderer's active MainTabs
        // tab — without this the view is attached+navigated but stuck
        // wherever the Browser tab's placeholder last reported its bounds
        // (possibly 0×0, if it's never been opened this session). See
        // MainTabs.tsx's window.yggdrasil.browserTab.onRequestShow for the
        // other half of this.
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send("browserTab:requestShow");
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && parts.length === 2 && parts[0] === "browser" && parts[1] === "pick") {
        const body = await readJsonBody(req);
        const timeoutMs = typeof body.timeoutMs === "number" ? body.timeoutMs : undefined;
        // Same auto-switch as /browser/open — the human needs to actually
        // see the Browser tab to click something in it.
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send("browserTab:requestShow");
        const picked = await browserTab.startPick(timeoutMs);
        sendJson(res, 200, { picked });
        return;
      }

      if (req.method === "GET" && parts.length === 1 && parts[0] === "plugins") {
        sendJson(res, 200, { plugins: await plugins.list() });
        return;
      }

      if (req.method === "POST" && parts.length === 2 && parts[0] === "plugins" && parts[1] === "scaffold") {
        const body = await readJsonBody(req);
        const rawViews = Array.isArray(body.views) ? body.views : undefined;
        const views = rawViews?.filter((v): v is PluginView => v === "tab" || v === "panel");
        try {
          const record = await plugins.scaffold({
            id: typeof body.id === "string" ? body.id : "",
            name: typeof body.name === "string" ? body.name : "",
            icon: typeof body.icon === "string" ? body.icon : undefined,
            scope: body.scope === "global" ? "global" : "project",
            views: views && views.length > 0 ? views : undefined,
            defaultView: body.defaultView === "panel" ? "panel" : body.defaultView === "tab" ? "tab" : undefined,
            permissions: Array.isArray(body.permissions) ? body.permissions.map(String) : undefined,
            description: typeof body.description === "string" ? body.description : undefined,
          });
          plugins.reload(record.scope, record.manifest.id);
          sendJson(res, 200, record);
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : "scaffold failed" });
        }
        return;
      }

      if (req.method === "POST" && parts.length === 4 && parts[0] === "plugins" && parts[3] === "reload") {
        const scope: PluginScope = parts[1] === "global" ? "global" : "project";
        plugins.reload(scope, parts[2]!);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && parts.length === 4 && parts[0] === "plugins" && parts[3] === "open") {
        const scope: PluginScope = parts[1] === "global" ? "global" : "project";
        const body = await readJsonBody(req);
        const view = body.view === "panel" ? "panel" : body.view === "tab" ? "tab" : undefined;
        plugins.open(scope, parts[2]!, view);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && parts.length === 2 && parts[0] === "plugins" && parts[1] === "api-docs") {
        sendJson(res, 200, { markdown: plugins.apiDocs() });
        return;
      }

      if (req.method === "GET" && parts.length === 2 && parts[0] === "plugins" && parts[1] === "tools") {
        const records = await plugins.list();
        const tools = records
          .filter((r) => !r.error && r.manifest.status !== "draft")
          .flatMap((r) =>
            (r.manifest.tools ?? []).map((tool) => ({ scope: r.scope, id: r.manifest.id, pluginName: r.manifest.name, tool })),
          );
        sendJson(res, 200, { tools });
        return;
      }

      if (req.method === "POST" && parts.length === 4 && parts[0] === "plugins" && parts[3] === "call-tool") {
        const scope: PluginScope = parts[1] === "global" ? "global" : "project";
        const id = parts[2]!;
        const body = await readJsonBody(req);
        const tool = typeof body.tool === "string" ? body.tool : "";
        if (!tool) {
          sendJson(res, 400, { error: "tool is required" });
          return;
        }
        // Validate against the published manifest BEFORE bothering the
        // renderer round trip at all — a draft, an unknown plugin, or an
        // undeclared tool name all fail fast, right here.
        const records = await plugins.list();
        const record = records.find((r) => r.scope === scope && r.manifest.id === id);
        if (!record || record.error || record.manifest.status === "draft") {
          sendJson(res, 404, { error: "unknown or unpublished plugin" });
          return;
        }
        if (!(record.manifest.tools ?? []).some((t) => t.name === tool)) {
          sendJson(res, 404, { error: `unknown tool "${tool}" on plugin "${id}"` });
          return;
        }
        try {
          const result = await plugins.callTool(scope, id, tool, body.params);
          sendJson(res, 200, { result });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : "tool call failed" });
        }
        return;
      }

      // /desktop/* — the tool-desktop package's tools (running in the
      // gateway subprocess, plain Node, no Electron access) call these to
      // reach systemPreferences/desktopCapturer/Notification, which only
      // exist here in Electron's main process. Same loopback+bearer-token
      // transport as everything else on this server — see
      // notes/automation/workflows-design.md §2/§7.3.
      if (req.method === "GET" && parts.length === 2 && parts[0] === "desktop" && parts[1] === "permissions") {
        sendJson(res, 200, await getDesktopAutomationAdapter().getPermissions());
        return;
      }

      if (req.method === "POST" && parts.length === 3 && parts[0] === "desktop" && parts[1] === "permissions" && parts[2] === "request") {
        const body = await readJsonBody(req);
        const kind: PermissionKind = body.kind === "accessibility" ? "accessibility" : "screen";
        await getDesktopAutomationAdapter().requestPermission(kind);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && parts.length === 2 && parts[0] === "desktop" && parts[1] === "frontmost") {
        const app = await getDesktopAutomationAdapter().getFrontmostApp();
        sendJson(res, 200, { app });
        return;
      }

      if (req.method === "POST" && parts.length === 2 && parts[0] === "desktop" && parts[1] === "open-app") {
        const body = await readJsonBody(req);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) {
          sendJson(res, 400, { error: "name is required" });
          return;
        }
        const waitFrontMs = typeof body.waitFrontMs === "number" ? body.waitFrontMs : undefined;
        const result = await getDesktopAutomationAdapter().openApp(name, waitFrontMs);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && parts.length === 2 && parts[0] === "desktop" && parts[1] === "notify") {
        const body = await readJsonBody(req);
        const title = typeof body.title === "string" ? body.title : "";
        const notifyBody = typeof body.body === "string" ? body.body : "";
        if (!title) {
          sendJson(res, 400, { error: "title is required" });
          return;
        }
        await getDesktopAutomationAdapter().notify({ title, body: notifyBody });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && parts.length === 2 && parts[0] === "desktop" && parts[1] === "screenshot") {
        const body = await readJsonBody(req);
        const mode = body.mode === "window" ? "window" : "screen";
        const app = typeof body.app === "string" ? body.app : undefined;
        try {
          const adapter = getDesktopAutomationAdapter();
          // Open+focus the target app *inside* this single approval-gated
          // call, rather than making the model call desktop_open_app (safe,
          // unprompted) first and desktop_screenshot (moderate, prompted)
          // second — that two-call shape is what let the approval dialog's
          // own click steal focus back to Yggdrasil in between and (before
          // the pickCaptureSource fix) silently capture the wrong window.
          // One approval now covers "open + capture" as a single action, as
          // the user asked.
          let openResult: Awaited<ReturnType<typeof adapter.openApp>> | undefined;
          if (mode === "window" && app) {
            openResult = await adapter.openApp(app);
            // becameFrontmost (lsappinfo) can go true a beat before the app
            // has actually finished laying out/painting its window — capturing
            // immediately risked grabbing it mid-render, and may also be why
            // desktopCapturer's window list hadn't picked up its window yet
            // (the Figma case found live). A short settle delay costs nothing
            // a human would notice but gives the window time to exist for real.
            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          try {
            const result = await adapter.screenshot({ mode, app });
            sendJson(res, 200, result);
          } catch (err) {
            // window-name matching (pickCaptureSource) is a best-effort text
            // match against desktopCapturer's window titles — unreliable for
            // some apps (found live: Figma's window title didn't contain
            // "Figma" at all, even though it really was frontmost).
            // openResult.becameFrontmost above is a completely independent
            // signal (lsappinfo, not desktopCapturer's window list) — when
            // THAT confirms the requested app truly is frontmost, a
            // whole-screen capture still honestly shows its real content,
            // which is a better answer than failing outright.
            const isWindowNotFound = err instanceof Error && err.message.startsWith("window_not_found");
            if (isWindowNotFound && openResult?.becameFrontmost) {
              const fallback = await adapter.screenshot({ mode: "screen" });
              sendJson(res, 200, {
                ...fallback,
                windowMatchFailed: true,
                note: `No open window titled like "${app}" was found, but it is the frontmost app — this is a full-screen capture instead of just its window.`,
              });
              return;
            }
            throw err;
          }
        } catch (err) {
          // Never falls through to a generic 500 that hides *why* — a
          // missing Screen Recording grant is the one failure this route
          // has to surface unambiguously (workflows-design.md §1's spike:
          // an unchecked capture returns the wallpaper as a silent
          // "success", which this permission gate exists specifically to
          // prevent turning into a tool_desktop_screenshot false positive).
          if (err instanceof PermissionRequiredError) {
            sendJson(res, 403, { error: "permission_required", message: `${err.kind} permission is required` });
            return;
          }
          throw err;
        }
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : "internal error" });
    }
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    token,
    shutdown: () => server.close(),
    getRateLimits: () => latestRateLimits,
    listPanes: doListPanes,
    createPane: doCreatePane,
    writePane: doWritePane,
  };
}
