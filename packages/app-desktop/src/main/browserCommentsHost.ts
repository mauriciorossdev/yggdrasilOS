import type { BrowserComment, CommentStatus } from "./browserComments.js";
import { buildCommentsPrompt } from "./browserCommentsPrompt.js";
import { buildCaptureBundle, buildCaptureFileName, scopeToMode } from "./browserCaptureBundle.js";
import type { ExtractedPage } from "./browserExtract.js";
import type { BrowserCommentsHost } from "./browserTabView.js";
import { deliverTask, type CommentProvider, type PanesApi } from "./taskDelivery.js";

export { waitForPaneReady, type CommentProvider } from "./taskDelivery.js";

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
        const { name } = await deliverTask({ panes: deps.panes, providers: deps.providers, sleep }, target, text);
        await deps.store.setStatus(chosen.map((c) => c.id), "sent", name);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
