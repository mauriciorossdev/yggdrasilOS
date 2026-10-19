import { watch as watchFsSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { notesResourceKey } from "./sharedResources.js";
import { pushResourceInBackground } from "./syncEngine.js";
import { getSharedResource } from "./sharedResources.js";

export type NotesWatchHandle = { close(): void };

/**
 * Watches <project>/notes/ for content changes and, for any changed file
 * that's a registered SharedResource, fires a background push — same
 * recursive fs.watch + 300ms-debounce-by-path shape as plugins.ts's
 * watchPluginsDir, just keyed by the full relative path (not only the first
 * segment) since notes/ can be nested and each file is its own resource.
 * Writes/deletes on notes/ made by this app already happen over the
 * gateway's own fs.write RPC (DocumentsView.tsx), which never touches
 * Electron main — this watcher is the only hook main has into that path.
 */
export function watchNotesDir(notesDir: string, projectId: string): NotesWatchHandle {
  let watcher: FSWatcher | undefined;
  let closed = false;
  const timers = new Map<string, NodeJS.Timeout>();
  let retryTimer: NodeJS.Timeout | undefined;

  function scheduleChange(relativePath: string): void {
    const existing = timers.get(relativePath);
    if (existing) clearTimeout(existing);
    timers.set(
      relativePath,
      setTimeout(() => {
        timers.delete(relativePath);
        const resourceKey = notesResourceKey(projectId, relativePath);
        void getSharedResource(resourceKey).then((resource) => {
          if (resource) pushResourceInBackground(resourceKey);
        });
      }, 300),
    );
  }

  function arm(): void {
    if (closed) return;
    try {
      watcher = watchFsSync(notesDir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        scheduleChange(filename.split(/[\\/]/).join("/"));
      });
      watcher.on("error", () => {
        watcher?.close();
        watcher = undefined;
        retryTimer = setTimeout(arm, 1000);
      });
    } catch {
      retryTimer = setTimeout(arm, 1000);
    }
  }

  arm();

  return {
    close() {
      closed = true;
      watcher?.close();
      if (retryTimer) clearTimeout(retryTimer);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}

export function notesAbsoluteDir(projectPath: string): string {
  return join(projectPath, "notes");
}
