import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import { ipcMain, type BrowserWindow } from "electron";
import * as pty from "node-pty";
// @xterm/headless ships as a bundled CJS module whose named exports aren't
// statically analyzable under Node ESM interop (only `default` — the whole
// module.exports object — comes through) — default-import + destructure is
// the form that actually works at runtime, verified against this exact
// package/version (a plain `import { Terminal }` throws "Terminal is not a
// constructor" here, despite typechecking fine against its .d.ts).
import xtermHeadlessPkg from "@xterm/headless";
const { Terminal: HeadlessTerminal } = xtermHeadlessPkg;
type HeadlessTerminal = InstanceType<typeof HeadlessTerminal>;
import { readTerminalLayout, writeTerminalLayout, type TerminalLayout } from "./terminalLayout.js";
import { discoverTranscriptPath, readTranscriptTail, type TranscriptMessage } from "./claudeTranscript.js";

const require = createRequire(import.meta.url);

export type TerminalId = string;

type TerminalHandle = {
  id: TerminalId;
  projectId: string;
  proc: pty.IPty;
  exitListener: pty.IDisposable;
  /**
   * A real (DOM-less) terminal emulator fed every raw pty chunk — same
   * engine the renderer's own xterm.js panes use (captureBuffer.ts), just
   * without a screen to draw to. Interprets cursor movement/erase/redraw
   * sequences properly, unlike the naive string-concat + `\r`-only model
   * this replaced: a TUI (Ink's own redraw technique, which moves the
   * cursor up multiple lines and rewrites them, not just `\r` on one line)
   * used to leave `readTerminalOutput` mostly blank lines. This resolves to
   * what the pane would actually show on screen right now.
   */
  headlessTerm: HeadlessTerminal;
  /**
   * A SECOND emulator fed the same bytes, kept at whatever column width a
   * reader last asked for via readTerminalOutputAtWidth (mobile's narrower
   * screen, typically) — resizing `headlessTerm` itself to match would also
   * resize the real pty (resizeTerminal ties the two together for the
   * desktop UI's own resize path), which would visibly reflow/break
   * whatever's actually being displayed on the desktop pane. This mirror
   * lets a phone see the same content rewrapped to its own width without
   * touching the desktop's live rendering at all.
   */
  mobileTerm: HeadlessTerminal;
  /**
   * Last size the DESKTOP UI actually asked for (via resizeTerminal, driven
   * by TerminalPane.tsx's own ResizeObserver) — the "true" native size to
   * restore to once no mobile viewer needs it wider. Needed because
   * mobileTerm's rewrap-on-read can't help a TUI like Ink: it hard-wraps its
   * OWN output based on the REAL pty width it's told (queried once + on
   * SIGWINCH), so making it readable on a phone requires actually widening
   * the live pty while a phone is looking — see expandTerminalForMobile.
   */
  desktopCols: number;
  desktopRows: number;
  /** How many mobile viewers currently have this pane force-widened — restoreTerminalNativeSize only actually restores once this hits 0. */
  mobileViewerCount: number;
  /** See CreateTerminalParams.flowNodeId. */
  flowNodeId?: string;
  /** See CreateTerminalParams.sessionKey — lets callers (paneControlServer.ts's GET /panes, the gateway's terminals.list) tie a pane back to its chat session. */
  sessionKey?: string;
  /** The literal command this pane was spawned with (e.g. "claude") — undefined for a plain shell. Used to gate the transcript feature (only "claude" panes have one) and surfaced via listTerminals() for mobile's UI. */
  command?: string;
  /** Working directory this pane was spawned with — needed at read time (not just spawn time) to run claudeTranscript.ts's discoverTranscriptPath. */
  cwd: string;
  /** Date.now() at spawn — discoverTranscriptPath's search window start. Set only for command === "claude"; undefined for every other pane (transcript feature doesn't apply). */
  transcriptSpawnedAt?: number;
  /**
   * Path to this `claude` pane's own Claude Code JSONL transcript, resolved
   * lazily via claudeTranscript.ts's discoverTranscriptPath (filesystem
   * discovery, not a predicted filename — --session-id is NOT honored by a
   * genuinely interactive/pty `claude` invocation, confirmed empirically;
   * only headless/-p mode honors it). undefined until readTranscript's first
   * successful discovery; re-attempted on every readTranscript call until found.
   */
  transcriptPath?: string;
  /** Byte offset into transcriptPath already consumed by readTranscript — lets repeated polls read only newly-appended bytes instead of re-parsing a potentially huge file every time. */
  transcriptOffset: number;
  /** A trailing partial JSONL line held back from the last readTranscript call (the writer flushed mid-object) — re-prefixed onto the next read rather than dropped. */
  transcriptLeftover: string;
  /** Every TranscriptMessage parsed so far for this pane, in file order — readTranscript appends to this and returns a bounded tail of it. */
  transcriptCache: TranscriptMessage[];
};

const terminals = new Map<TerminalId, TerminalHandle>();

// Generous — this is scrollback lines, not characters (readTerminalOutput's
// maxChars still bounds the actual response size on read).
const HEADLESS_SCROLLBACK = 2000;

// mobileTerm's starting width, before any reader requests a specific one via
// readTerminalOutputAtWidth — a reasonable phone-portrait default.
const MOBILE_DEFAULT_COLS = 48;
const MOBILE_ROWS = 30;

/** Every line currently in the headless terminal's buffer (scrollback + viewport), trailing blank lines trimmed, as plain text (colors/formatting stripped). */
function readBufferText(term: HeadlessTerminal): string {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    lines.push(line ? line.translateToString(true) : "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

// Windows 10 1809+ ConPTY only — no winpty fallback attempted. node-pty picks
// this automatically via its own `useConpty` default; nothing extra needed
// here beyond choosing the shell binary itself.
function defaultShell(): string {
  return process.platform === "win32" ? "powershell.exe" : (process.env.SHELL ?? "/bin/bash");
}

export type CreateTerminalParams = {
  id: TerminalId;
  projectId: string;
  cwd: string;
  cols: number;
  rows: number;
  // Agent Flow-spawned panes only — a plain terminal pane omits all of
  // these, so behavior below is byte-identical to a bare shell spawn.
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** When set, overrides command/args entirely — see resolveYggdrasilTuiCommand. */
  yggdrasilAgentId?: string;
  /** yggdrasilAgentId only — join this exact session instead of minting a fresh TUI one, so the pane shows a "Run Flow" run live. */
  sessionKey?: string;
  /** yggdrasilAgentId only — the autonomous run owns this session; block human input into it from this pane. */
  readOnly?: boolean;
  /**
   * Which AgentFlowNode/AgentTeam node this leaf was spawned from, if any —
   * the renderer already round-trips this through terminal-layout.json to
   * rebuild Delegate links after a restart (see TerminalContainer.tsx). It's
   * threaded through here too so paneControlServer.ts's /whoami can resolve
   * a *reloaded* pane back to its original stable node id instead of the
   * fresh ephemeral pane id it got this time around — without this, every
   * reload of a saved Team would look like a brand-new orchestrator to
   * recordAutoCapturedNode, fragmenting the graph across reloads.
   */
  flowNodeId?: string;
  /**
   * A node's designed task, round-tripped through as metadata — NOT
   * auto-submitted on spawn (see createTerminal: instantiating a pane must
   * never trigger work on its own; only an explicit human message to an
   * orchestrator, or the orchestrator's own write_pane call to a worker it
   * just created, should). Kept as a separate field (never baked into
   * `args`) so it stays inspectable/editable without pretending to be part
   * of the actual launch command.
   */
  initialPrompt?: string;
  /** How to pass initialPrompt to this harness's CLI — undefined means a bare positional; e.g. "-i" for antigravity. See buildLaunchCommand.ts. */
  initialPromptFlag?: string;
};

/**
 * node-pty's Windows/ConPTY native binding does NOT search PATH or
 * auto-append .exe the way CreateProcess's docs claim / the way cmd.exe
 * does — a bare command name like "claude" (found fine by a plain `where`
 * or by node's own child_process.spawn) throws "File not found:" here
 * unless given an absolute, extension-qualified path. `defaultShell()`'s
 * "powershell.exe" works unresolved only because it also lives in the
 * System32 search path CreateProcess checks before PATH — a user-installed
 * PATH-only binary like claude/agy has no such shortcut. Unix's node-pty
 * backend doesn't need this (glibc's execvp does PATH search itself).
 */
function findOnWindowsPath(command: string): string | null {
  if (process.platform !== "win32" || /[\\/]/.test(command)) return null;
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = ["", ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolveWindowsExecutable(command: string): string {
  return findOnWindowsPath(command) ?? command;
}

/**
 * Resolves @yggdrasil/cli's built entry and runs it via `tui --agent <id>
 * --connect <gatewayUrl>`, so the spawned TUI joins this project's existing
 * gateway rather than booting a redundant second one.
 *
 * gateway.ts's sidecar spawn runs the CLI under Electron's own bundled Node
 * (ELECTRON_RUN_AS_NODE) specifically to avoid requiring an external Node
 * install — that works fine there because it's non-interactive (stdio
 * pipes only). It does NOT work for an interactive terminal pane: on
 * Windows, electron.exe is a GUI-subsystem binary, and empirically (via a
 * standalone node-pty spike) its stdout/stdin never attach to a ConPTY
 * pseudo-console at all — it exits cleanly but produces zero terminal
 * output, so Ink's raw-mode input handling fails silently. A real `node`
 * binary has no such issue, so prefer one found on PATH; fall back to
 * Electron's bundled Node only when no system Node is available (that
 * fallback is known-broken for this specific interactive case on Windows —
 * an accepted limitation, same posture as node-pty's own documented
 * ConPTY grandchild-cleanup rough edge).
 */
function resolveYggdrasilTuiCommand(
  agentId: string,
  gatewayUrl: string,
  sessionKey: string | undefined,
  readOnly: boolean | undefined,
): { command: string; args: string[]; env: Record<string, string> } {
  const cliEntry = require.resolve("@yggdrasil/cli");
  const args = [cliEntry, "tui", "--agent", agentId, "--connect", gatewayUrl];
  if (sessionKey) args.push("--session", sessionKey);
  if (readOnly) args.push("--readonly");

  const systemNode = process.platform === "win32" ? findOnWindowsPath("node") : "node";
  if (systemNode) {
    return { command: systemNode, args, env: {} };
  }
  return { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

export function createTerminal(
  params: CreateTerminalParams,
  gatewayUrl: string | undefined,
  onData: (chunk: string) => void,
  onExit: (exitCode: number | null) => void,
): void {
  // A stale/duplicate create for an id that's already live (e.g. a renderer
  // re-hydrate racing a still-open pane) must not leak the old process.
  disposeTerminal(params.id);

  const resolved =
    params.yggdrasilAgentId && gatewayUrl
      ? resolveYggdrasilTuiCommand(params.yggdrasilAgentId, gatewayUrl, params.sessionKey, params.readOnly)
      : params.command
        ? { command: resolveWindowsExecutable(params.command), args: params.args ?? [], env: params.env }
        : { command: defaultShell(), args: params.args ?? [], env: params.env };

  // Deliberately NOT appended to resolved.args: instantiating a pane must
  // never auto-submit work on its own — only an explicit action (the human
  // typing into an orchestrator, or the orchestrator's own write_pane call
  // into a worker it just created) should. params.initialPrompt/
  // initialPromptFlag are carried through as metadata (round-tripped from
  // the node's designed task, still readable/editable in NodeConfigDrawer)
  // but currently unused for spawning — kept for a future explicit
  // "send this pane its task" action, not fired implicitly here.

  const proc = pty.spawn(resolved.command, resolved.args, {
    name: "xterm-color",
    cols: params.cols,
    rows: params.rows,
    cwd: params.cwd,
    env: { ...process.env, ...resolved.env } as Record<string, string>,
  });

  const handle: TerminalHandle = {
    id: params.id,
    projectId: params.projectId,
    proc,
    // Replaced immediately below — proc.onExit needs `handle` to already
    // exist (for the tail buffer's lifetime), and disposeListener needs a
    // real IDisposable, so this placeholder is only ever momentarily unset.
    exitListener: { dispose() {} },
    // allowProposedApi: `buffer` (read below in readBufferText) is behind
    // xterm.js's proposed-API flag — throws without this at first access.
    headlessTerm: new HeadlessTerminal({
      cols: params.cols,
      rows: params.rows,
      scrollback: HEADLESS_SCROLLBACK,
      allowProposedApi: true,
    }),
    mobileTerm: new HeadlessTerminal({
      cols: MOBILE_DEFAULT_COLS,
      rows: MOBILE_ROWS,
      scrollback: HEADLESS_SCROLLBACK,
      allowProposedApi: true,
    }),
    desktopCols: params.cols,
    desktopRows: params.rows,
    mobileViewerCount: 0,
    flowNodeId: params.flowNodeId,
    sessionKey: params.sessionKey,
    command: params.command,
    cwd: params.cwd,
    transcriptSpawnedAt: params.command === "claude" ? Date.now() : undefined,
    transcriptOffset: 0,
    transcriptLeftover: "",
    transcriptCache: [],
  };

  proc.onData((chunk) => {
    handle.headlessTerm.write(chunk);
    handle.mobileTerm.write(chunk);
    onData(chunk);
  });
  handle.exitListener = proc.onExit(({ exitCode }) => {
    terminals.delete(params.id);
    // An exception escaping here propagates into node-pty's native exit
    // callback, which turns it into abort() — never let one through.
    try {
      onExit(exitCode);
    } catch (error) {
      console.error("[terminals] onExit handler threw", error);
    }
  });

  terminals.set(params.id, handle);
}

export function writeToTerminal(id: TerminalId, data: string): void {
  terminals.get(id)?.proc.write(data);
}

export function terminalExists(id: TerminalId): boolean {
  return terminals.has(id);
}

/**
 * Maps a live pty's OS pid back to the pane id that owns it — used by
 * paneControlServer.ts's /whoami so an MCP tool call can self-identify
 * which pane it's running inside via process ancestry (its own
 * process.ppid), rather than relying on env vars surviving whatever the
 * `claude` CLI's MCP client does when spawning its stdio server children
 * (unverified, and the MCP spec deliberately curates that environment
 * rather than inheriting it wholesale — pid-based lookup sidesteps the
 * question entirely).
 */
export function findTerminalIdByPid(pid: number): TerminalId | undefined {
  for (const handle of terminals.values()) {
    if (handle.proc.pid === pid) return handle.id;
  }
  return undefined;
}

/**
 * Every live pane, not just ones create_pane spawned — paneControlServer.ts's
 * own `panes` Map only ever gets entries from its own POST /panes handler, so
 * a Team reloaded via the ordinary Terminal-tab hydration path is otherwise
 * invisible to list_panes even though the panes are genuinely alive here.
 */
export function listTerminals(): Array<{ id: TerminalId; flowNodeId?: string; sessionKey?: string; command?: string }> {
  return [...terminals.values()].map((h) => ({
    id: h.id,
    flowNodeId: h.flowNodeId,
    sessionKey: h.sessionKey,
    command: h.command,
  }));
}

/** See CreateTerminalParams.flowNodeId — the stable node id this live pane was reloaded from, if any. */
export function getFlowNodeId(id: TerminalId): string | undefined {
  return terminals.get(id)?.flowNodeId;
}

/** Plain-text (ANSI-stripped, redraw-resolved) tail of a pane's recent output — see readBufferText. undefined for an unknown/closed id. */
export function readTerminalOutput(id: TerminalId, maxChars = 4000): string | undefined {
  const handle = terminals.get(id);
  if (!handle) return undefined;
  return readBufferText(handle.headlessTerm).slice(-maxChars);
}

/**
 * Same as readTerminalOutput, but rewrapped to `cols` columns — see
 * mobileTerm. Only resizes the mirror (a no-op when already at that width),
 * never the real pty/desktop-facing headlessTerm.
 */
export function readTerminalOutputAtWidth(id: TerminalId, cols: number, maxChars = 4000): string | undefined {
  const handle = terminals.get(id);
  if (!handle) return undefined;
  if (handle.mobileTerm.cols !== cols) handle.mobileTerm.resize(cols, handle.mobileTerm.rows);
  return readBufferText(handle.mobileTerm).slice(-maxChars);
}

/** Path to this pane's Claude Code transcript, if it's a `claude` pane spawned with a minted --session-id — see TerminalHandle.transcriptPath. undefined for any other pane, or an unknown id. */
export function getTranscriptPath(id: TerminalId): string | undefined {
  return terminals.get(id)?.transcriptPath;
}

// Bounded tail returned per request — keeps the RPC payload/JSON size sane
// even once a long-running pane's in-memory transcriptCache has grown past
// this; the full cache is still kept so tool_use/tool_result pairing across
// reads stays correct.
const TRANSCRIPT_TAIL_LIMIT = 500;

/**
 * Incrementally reads+parses this pane's Claude Code transcript (only the
 * bytes appended since the last call — see readTranscriptTail) and returns a
 * bounded tail of every message parsed so far. `available: false` means this
 * isn't a `claude` pane at all — callers should fall back to
 * readTerminalOutput's raw text in that case. A `claude` pane whose
 * transcript file hasn't been discovered yet (still starting up) comes back
 * `available: true` with an empty list — not a failure, just "nothing to
 * show yet"; discovery is retried on every call until it succeeds.
 */
export async function readTranscript(
  id: TerminalId,
): Promise<{ available: boolean; messages: TranscriptMessage[] }> {
  const handle = terminals.get(id);
  if (!handle || handle.transcriptSpawnedAt === undefined) return { available: false, messages: [] };

  if (!handle.transcriptPath) {
    handle.transcriptPath = await discoverTranscriptPath(handle.cwd, handle.transcriptSpawnedAt);
    if (!handle.transcriptPath) return { available: true, messages: [] };
  }

  try {
    const { messages, newOffset, newLeftover } = await readTranscriptTail(
      handle.transcriptPath,
      handle.transcriptOffset,
      handle.transcriptLeftover,
    );
    if (messages.length > 0) handle.transcriptCache.push(...messages);
    handle.transcriptOffset = newOffset;
    handle.transcriptLeftover = newLeftover;
    return { available: true, messages: handle.transcriptCache.slice(-TRANSCRIPT_TAIL_LIMIT) };
  } catch {
    // Discovery picked a candidate that turned out to be unreadable/gone —
    // reset and let the next poll's discovery try again from scratch.
    handle.transcriptPath = undefined;
    return { available: true, messages: handle.transcriptCache.slice(-TRANSCRIPT_TAIL_LIMIT) };
  }
}

/** Desktop's own resize path (TerminalPane.tsx's ResizeObserver → terminal:resize IPC). */
export function resizeTerminal(id: TerminalId, cols: number, rows: number): void {
  const handle = terminals.get(id);
  if (!handle) return;
  handle.desktopCols = cols;
  handle.desktopRows = rows;
  // A mobile viewer currently owns the real pty's width (expandTerminalForMobile)
  // — remember this as the new native size instead of stomping it back down
  // mid-view; restoreTerminalNativeSize applies it once they're done.
  if (handle.mobileViewerCount > 0) return;
  handle.proc.resize(cols, rows);
  handle.headlessTerm.resize(cols, rows);
}

/**
 * Widens the REAL pty (not just a read-side mirror) so a TUI like Ink
 * re-renders its own output at a phone-readable width — mobileTerm's rewrap
 * can't do this on its own since Ink hard-wraps based on the actual pty size
 * it's told, not a soft xterm-level wrap. Real, visible side effect: the
 * desktop pane's own on-screen content reflows too while a phone is
 * viewing (same tradeoff any terminal multiplexer has — one pty, one real
 * size, shared by everyone attached). Restored via restoreTerminalNativeSize.
 */
/** Returns true exactly when this call transitions the pane from "no mobile viewer" to "has one" — the caller (paneControlServer.ts) uses this to know when to notify the renderer (pane:mobileFocus) rather than on every concurrent viewer. */
export function expandTerminalForMobile(id: TerminalId, cols: number, rows: number): boolean {
  const handle = terminals.get(id);
  if (!handle) return false;
  const wasIdle = handle.mobileViewerCount === 0;
  handle.mobileViewerCount++;
  handle.proc.resize(cols, rows);
  handle.headlessTerm.resize(cols, rows);
  return wasIdle;
}

/** Pairs with expandTerminalForMobile — restores the desktop's own last-known size once every mobile viewer has left. Returns true exactly when this call is the one that brought the viewer count back to 0. */
export function restoreTerminalNativeSize(id: TerminalId): boolean {
  const handle = terminals.get(id);
  if (!handle) return false;
  handle.mobileViewerCount = Math.max(0, handle.mobileViewerCount - 1);
  if (handle.mobileViewerCount > 0) return false;
  handle.proc.resize(handle.desktopCols, handle.desktopRows);
  handle.headlessTerm.resize(handle.desktopCols, handle.desktopRows);
  return true;
}

export function disposeTerminal(id: TerminalId, signal?: string): void {
  const handle = terminals.get(id);
  if (!handle) return;
  terminals.delete(id);
  // Detach before killing — a *deliberate* dispose (CLOSE, a duplicate
  // create()'s defensive cleanup, StrictMode's mount->cleanup->mount) must
  // never notify the renderer via the stored onExit callback. Only a real
  // spontaneous exit (shell crashed, user typed `exit`) should ever produce
  // a "terminal:exit" event — otherwise a fresh replacement process for the
  // same id can be mistaken by its own just-mounted UI for having exited,
  // once the old process's exit event round-trips back after the new one is
  // already up.
  handle.exitListener.dispose();
  handle.proc.kill(signal);
  handle.headlessTerm.dispose();
  handle.mobileTerm.dispose();
}

export function disposeTerminalsForProject(projectId: string): void {
  for (const handle of terminals.values()) {
    if (handle.projectId === projectId) disposeTerminal(handle.id);
  }
}

export function disposeAllTerminals(): void {
  for (const id of [...terminals.keys()]) disposeTerminal(id);
}

/**
 * Quit-time variant: SIGKILLs every pty and waits (bounded) for each exit to be
 * delivered before returning. node-pty 1.1.0 reports exits through a native
 * ThreadSafeFunction that re-enters JS; if a child's exit lands while Node is
 * already tearing its environment down (FreeEnvironment), that call fails and
 * the addon throws a C++ exception nobody catches -> abort() (SIGABRT in
 * pty.node `Napi::ThreadSafeFunction::CallJS`). Draining exits first, while JS
 * is still alive, avoids it.
 */
export async function disposeAllTerminalsAndWait(timeoutMs = 2000): Promise<void> {
  const exits: Promise<void>[] = [];
  for (const id of [...terminals.keys()]) {
    const handle = terminals.get(id);
    if (!handle) continue;
    exits.push(
      new Promise<void>((resolve) => {
        handle.proc.onExit(() => resolve());
      }),
    );
    disposeTerminal(id, "SIGKILL");
  }
  if (exits.length === 0) return;
  await Promise.race([Promise.all(exits), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

export function registerTerminalIpc(
  getWindow: (projectId: string) => BrowserWindow | undefined,
  getGatewayUrl: (projectId: string) => string | undefined,
): void {
  ipcMain.handle(
    "terminal:create",
    (_event, params: CreateTerminalParams) => {
      createTerminal(
        params,
        getGatewayUrl(params.projectId),
        (chunk) => {
          const win = getWindow(params.projectId);
          if (win && !win.isDestroyed()) win.webContents.send("terminal:data", { id: params.id, chunk });
        },
        (exitCode) => {
          const win = getWindow(params.projectId);
          if (win && !win.isDestroyed()) win.webContents.send("terminal:exit", { id: params.id, exitCode });
        },
      );
    },
  );

  ipcMain.handle("terminal:write", (_event, id: TerminalId, data: string) => writeToTerminal(id, data));
  ipcMain.handle("terminal:resize", (_event, id: TerminalId, cols: number, rows: number) =>
    resizeTerminal(id, cols, rows),
  );
  ipcMain.handle("terminal:dispose", (_event, id: TerminalId) => disposeTerminal(id));
  ipcMain.handle("terminal:read", (_event, id: TerminalId, maxChars?: number) => readTerminalOutput(id, maxChars));
  ipcMain.handle("terminal:getLayout", (_event, projectId: string) => readTerminalLayout(projectId));
  ipcMain.handle("terminal:saveLayout", (_event, projectId: string, layout: TerminalLayout) =>
    writeTerminalLayout(projectId, layout),
  );
}
