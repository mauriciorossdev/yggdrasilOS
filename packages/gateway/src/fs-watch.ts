import chokidar, { type FSWatcher } from "chokidar";
import { relative, sep } from "node:path";
import { loadIgnoreMatcher } from "./fs-ignore.js";
import type { GatewayContext } from "./methods.js";

const DEBOUNCE_MS = 300;

/**
 * Pushes an "fs.changed" event to every connected client (server.ts wires it
 * into the same per-connection broadcast as chat.delta/tool.approval.*)
 * whenever a file/directory is added or removed under `root` — this is what
 * lets FileTree.tsx (project files + Documents, same component) pick up
 * files an agent/import/external editor added without the user having to
 * collapse/expand the folder to force a manual refetch.
 *
 * Also emits a broader "fs.contentChanged" (via the same shared `events`
 * bus; server.ts forwards it to WS clients too, for DocumentsView.tsx's
 * live reload) covering add/change/unlink alike, content edits included —
 * "fs.changed" deliberately stays structural-only (add/remove) since that's
 * all a directory listing cares about, but a plugin like context-memory-db
 * needs to know about a plain content edit too (the common "on save" case)
 * to auto-reindex, and doing that off THIS single watcher instead of
 * running a second recursive one avoids doubling the native fs.watch()
 * handle count against the same tree — a real project can already burn
 * through the OS's per-process fd limit with just one recursive watcher
 * (EMFILE) when chokidar falls back to per-directory fs.watch() instead of
 * a native backend; a second independent one only makes that worse.
 *
 * Respects the same .gitignore-based matcher as fs.list, so a `git status`
 * or a build writing into node_modules/dist doesn't spam refresh events for
 * directories the tree doesn't even show.
 */
export async function startFsWatcher(root: string, events: GatewayContext["events"]): Promise<() => Promise<void>> {
  const ig = await loadIgnoreMatcher(root);

  const watcher: FSWatcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (path: string) => {
      const rel = relative(root, path).split(sep).join("/");
      return rel !== "" && ig.ignores(rel);
    },
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingStructuralPaths = new Set<string>();
  let pendingContentPaths = new Set<string>();
  const flush = () => {
    timer = null;
    if (pendingStructuralPaths.size > 0) {
      const paths = [...pendingStructuralPaths];
      pendingStructuralPaths = new Set();
      void events.emit("fs.changed", { paths });
    }
    if (pendingContentPaths.size > 0) {
      const paths = [...pendingContentPaths];
      pendingContentPaths = new Set();
      void events.emit("fs.contentChanged", { paths });
    }
  };
  const schedule = (structural: boolean, content: boolean, path: string) => {
    const rel = relative(root, path).split(sep).join("/");
    if (structural) pendingStructuralPaths.add(rel);
    if (content) pendingContentPaths.add(rel);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  };

  // add/unlink matter to both channels — a new/deleted file changes what a
  // directory listing shows (structural) *and* needs indexing/de-indexing
  // (content). addDir/unlinkDir are structural-only (a directory isn't
  // indexable content); change is content-only (editing a file's content
  // doesn't add/remove anything from a listing).
  watcher.on("add", (path) => schedule(true, true, path));
  watcher.on("unlink", (path) => schedule(true, true, path));
  watcher.on("addDir", (path) => schedule(true, false, path));
  watcher.on("unlinkDir", (path) => schedule(true, false, path));
  watcher.on("change", (path) => schedule(false, true, path));
  // A single unwatchable path (e.g. the "Default Workspace" project's root
  // IS the Electron userData dir, which contains a SingletonSocket —
  // fs.watch() can't watch a Unix socket, and chokidar's default "no
  // listener" behavior on 'error' throws, taking the whole gateway process
  // down with it) must not crash the rest of the watcher.
  watcher.on("error", (err) => {
    console.warn("[fs-watch] watcher error (ignored, watching continues):", err);
  });

  return async () => {
    if (timer) clearTimeout(timer);
    await watcher.close();
  };
}
