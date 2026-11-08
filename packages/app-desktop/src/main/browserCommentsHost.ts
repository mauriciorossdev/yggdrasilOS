import type { BrowserComment, CommentStatus } from "./browserComments.js";
import { buildCommentsPrompt } from "./browserCommentsPrompt.js";
import { buildCaptureBundle, buildCaptureFileName, scopeToMode } from "./browserCaptureBundle.js";
import type { ExtractedPage } from "./browserExtract.js";
import type { BrowserCommentsHost, CommentSendTarget } from "./browserTabView.js";

export type CommentProvider = { id: string; label: string; command: string };

type PanesApi = {
  list: () => Promise<Array<{ id: string; title: string; command?: string }>>;
  create: (spec: { command: string; title: string }) => Promise<{ id: string }>;
  write: (id: string, text: string, pressEnter: boolean) => Promise<void>;
  /** Recent plain-text output; undefined once the pane is gone. */
  read: (id: string, maxChars: number) => string | undefined;
};

export type CommentsHostDeps = {
  store: {
    list: (pageUrl: string) => Promise<BrowserComment[]>;
    add: BrowserCommentsHost["add"];
    update: BrowserCommentsHost["update"];
    remove: BrowserCommentsHost["remove"];
    setStatus: (ids: string[], status: CommentStatus, sentTo?: string) => Promise<boolean>;
  };
  panes: PanesApi;
  /** Persists a capture bundle; resolves with its project-relative path. */
  captures: { write: (fileName: string, content: string) => Promise<string> };
  now?: () => Date;
  /** CLIs the user can launch (pushed by the renderer, which owns the enabled-CLIs setting). */
  providers: () => CommentProvider[];
  sleep?: (ms: number) => Promise<void>;
};

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

export function createBrowserCommentsHost(deps: CommentsHostDeps): BrowserCommentsHost {
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    list: deps.store.list,
    add: deps.store.add,
    update: deps.store.update,
    remove: deps.store.remove,
    setStatus: async (ids, status) => {
      await deps.store.setStatus(ids, status);
    },
    targets: async () => ({ panes: await deps.panes.list(), providers: deps.providers() }),
    send: async ({ pageUrl, ids, target }, page) => {
      const all = await deps.store.list(pageUrl);
      const chosen = ids ? all.filter((c) => ids.includes(c.id)) : all;
      if (chosen.length === 0) return { ok: false, error: "No comments to send" };
      try {
        // Captures are extracted now, from the page the user is looking at, and handed over as files.
        const bundles = new Map<string, string>();
        for (const c of chosen.filter((x) => x.kind === "capture")) {
          const mode = scopeToMode(c.scope ?? "element");
          let extracted: ExtractedPage | null = null;
          if (mode) {
            try {
              extracted = await page.extract({ mode, selector: mode === "element" ? c.selector : undefined });
            } catch (err) {
              throw new Error(`Could not capture ${c.scope ?? "element"} (${err instanceof Error ? err.message : String(err)})`);
            }
          }
          const when = (deps.now ?? (() => new Date()))();
          bundles.set(c.id, await deps.captures.write(buildCaptureFileName(c, when), buildCaptureBundle({ comment: c, extracted, capturedAt: when })));
        }
        const text = buildCommentsPrompt(chosen, pageUrl, bundles);
        const name = await deliver(target, text);
        await deps.store.setStatus(chosen.map((c) => c.id), "sent", name);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  /** Resolves with the display name of whoever received the task. */
  async function deliver(target: CommentSendTarget, text: string): Promise<string> {
    if (target.kind === "pane") {
      await deps.panes.write(target.paneId, text, true);
      return target.name ?? "agent";
    }
    // Only commands the renderer offered as launchable — the page can't smuggle an arbitrary binary through this IPC.
    const provider = deps.providers().find((p) => p.command === target.command);
    if (!provider) throw new Error(`Unknown provider: ${target.command}`);
    const { id } = await deps.panes.create({ command: provider.command, title: provider.label });
    const ready = await waitForPaneReady(deps.panes, id, sleep);
    if (!ready) throw new Error(`${provider.label} did not become ready; pane created but task not sent`);
    await deps.panes.write(id, text, true);
    return provider.label;
  }
}
