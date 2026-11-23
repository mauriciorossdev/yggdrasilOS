/**
 * Hands a task (plain text typed into a TUI) to an agent: an existing pane, or
 * a fresh CLI pane once it's ready for input. Shared by the Browser's element
 * comments (browserCommentsHost.ts) and the code review comments
 * (codeCommentsHost.ts).
 */

export type CommentProvider = { id: string; label: string; command: string };

export type PanesApi = {
  list: () => Promise<Array<{ id: string; title: string; command?: string; cwd?: string }>>;
  create: (spec: { command: string; title: string; cwd?: string }) => Promise<{ id: string }>;
  /** Resolves with where it went when the pane's queue held it (paneQueueHost.ts). */
  write: (id: string, text: string, pressEnter: boolean) => Promise<{ queued: boolean; position?: number } | void>;
  /** Recent plain-text output; undefined once the pane is gone. */
  read: (id: string, maxChars: number) => string | undefined;
};

export type TaskTarget = { kind: "pane"; paneId: string; name?: string } | { kind: "new"; command: string; label: string };

const READY_POLL_MS = 250;
const READY_STABLE_POLLS = 3;
const READY_MAX_MS = 20_000;

/**
 * A freshly spawned TUI swallows input typed before it has drawn its prompt, so
 * wait until the pane has printed something and then stopped changing.
 */
export async function waitForPaneReady(
  panes: Pick<PanesApi, "read">,
  id: string,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  let last = "";
  let stable = 0;
  for (let waited = 0; waited < READY_MAX_MS; waited += READY_POLL_MS) {
    await sleep(READY_POLL_MS);
    const out = panes.read(id, 4000);
    if (out === undefined) return false;
    if (out.length > 0 && out === last) {
      if (++stable >= READY_STABLE_POLLS) return true;
    } else {
      stable = 0;
      last = out;
    }
  }
  return false;
}

export type Delivered = { name: string; queued?: boolean; position?: number };

/** Resolves with who received the task, and whether it waits in that pane's queue. `cwd` is where a new agent starts. */
export async function deliverTask(
  deps: { panes: PanesApi; providers: () => CommentProvider[]; sleep: (ms: number) => Promise<void> },
  target: TaskTarget,
  text: string,
  cwd?: string,
): Promise<Delivered> {
  if (target.kind === "pane") {
    const res = await deps.panes.write(target.paneId, text, true);
    return { name: target.name ?? "agent", ...(res?.queued ? { queued: true, position: res.position } : {}) };
  }
  // Only commands the renderer offered as launchable — the caller can't smuggle an arbitrary binary through IPC.
  const provider = deps.providers().find((p) => p.command === target.command);
  if (!provider) throw new Error(`Unknown provider: ${target.command}`);
  const { id } = await deps.panes.create({ command: provider.command, title: provider.label, ...(cwd ? { cwd } : {}) });
  const ready = await waitForPaneReady(deps.panes, id, deps.sleep);
  if (!ready) throw new Error(`${provider.label} did not become ready; pane created but task not sent`);
  await deps.panes.write(id, text, true);
  return { name: provider.label };
}
