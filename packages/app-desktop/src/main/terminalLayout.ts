import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";

export type PaneNode =
  | {
      type: "leaf";
      id: string;
      title: string;
      cwd: string;
      // Set only for Agent Flow-spawned panes — a plain terminal pane never
      // sets these, so pty.spawn keeps launching a bare shell as before.
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      // When set, overrides command/args/env entirely — main resolves the
      // yggdrasil CLI's TUI invocation itself (needs process.execPath /
      // the CLI's own resolved entry path, unavailable to the renderer).
      yggdrasilAgentId?: string;
      // Which AgentFlowNode this leaf was spawned from, if any — round-tripped
      // through terminal-layout.json purely so the renderer can rebuild
      // flowLinks (Delegate buttons) after an app restart, matching this back
      // against agent-flow.json. Main process never reads this field itself.
      flowNodeId?: string;
      // Set for a pane an agent spawned via the create_pane MCP tool — its
      // pty already exists in this process's terminals map by the time this
      // leaf is persisted, so main never (re)spawns it from this field.
      attach?: boolean;
      // "Type this and press enter" for the *next* real spawn only — see
      // createTerminal's use of it. Not baked into `args` so a plain
      // hydrate-restore respawn (renderer's paneTree.ts HYDRATE case) can
      // strip it before this ever reaches main, without losing args' other
      // (persistent) flags.
      initialPrompt?: string;
      // How to pass initialPrompt to this harness's CLI — undefined means a
      // bare positional; e.g. "-i" for antigravity.
      initialPromptFlag?: string;
      // Free-form position for Terminal Canvas mode (TerminalNavbar's
      // "Canvas" toggle) — undefined until the user has actually dragged
      // this pane's canvas node at least once; TerminalCanvasView computes
      // a cascade default when absent. Main process never reads this field
      // itself (same convention as flowNodeId) — pure round-trip storage.
      canvasPosition?: { x: number; y: number };
    }
  | { type: "split"; id: string; direction: "row" | "column"; sizes: number[]; children: PaneNode[] };

export type TerminalLayout = {
  root: PaneNode | null;
  activePaneId: string | null;
  /** "grid" (default) or "canvas" — persisted so reopening a project remembers which view the Terminal tab was left in. Absent means "grid" (pre-existing saved layouts never had this field). */
  viewMode?: "grid" | "canvas";
};

const EMPTY_LAYOUT: TerminalLayout = { root: null, activePaneId: null };

type LayoutFile = Record<string, TerminalLayout>;

function layoutPath(): string {
  return join(app.getPath("userData"), "terminal-layout.json");
}

async function readLayoutFile(): Promise<LayoutFile> {
  try {
    const raw = await readFile(layoutPath(), "utf8");
    return JSON.parse(raw) as LayoutFile;
  } catch {
    return {};
  }
}

async function writeLayoutFile(file: LayoutFile): Promise<void> {
  await mkdir(dirname(layoutPath()), { recursive: true });
  await writeFile(layoutPath(), JSON.stringify(file, null, 2), "utf8");
}

/** Layout only — pane tree shape, sizes, titles, creation-time cwd. Never a live process handle. */
export async function readTerminalLayout(projectId: string): Promise<TerminalLayout> {
  const file = await readLayoutFile();
  return file[projectId] ?? EMPTY_LAYOUT;
}

export async function writeTerminalLayout(projectId: string, layout: TerminalLayout): Promise<void> {
  const file = await readLayoutFile();
  file[projectId] = layout;
  await writeLayoutFile(file);
}
