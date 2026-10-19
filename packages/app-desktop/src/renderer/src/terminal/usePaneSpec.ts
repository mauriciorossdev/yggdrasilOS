import { useEffect, useState, useSyncExternalStore } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { FsReadResult } from "../types.js";
import { derivePaneSpecBadge, type PaneSpecBadge } from "./paneSpecBadge.js";

// pane id -> project-relative feature doc path, fed by main's "pane:spec" event
// (write_pane with specPath). Module-level so a pane that is minimized or
// remounted by layout changes still knows its doc; session-only like the ptys.
const specs = new Map<string, string>();
const listeners = new Set<() => void>();
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed || typeof window === "undefined" || !window.yggdrasil?.terminals?.onSpec) return;
  subscribed = true;
  window.yggdrasil.terminals.onSpec((paneId, specPath) => {
    if (specs.get(paneId) === specPath) return;
    specs.set(paneId, specPath);
    listeners.forEach((fn) => fn());
  });
}
ensureSubscribed();

function subscribe(fn: () => void): () => void {
  ensureSubscribed();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The feature doc a pane was handed (write_pane's specPath) and its live
 * status chip. Re-reads the doc when it changes on disk, so an agent ticking
 * a task or flipping `Status:` shows up in the pane header without a refresh.
 * `badge` is null until the doc has been read, and again if it is deleted.
 */
export function usePaneSpec(paneId: string): { specPath: string | null; badge: PaneSpecBadge | null } {
  const { call, onEvent } = useGateway();
  const specPath = useSyncExternalStore(subscribe, () => specs.get(paneId) ?? null);
  const [badge, setBadge] = useState<PaneSpecBadge | null>(null);

  useEffect(() => {
    if (!specPath) {
      setBadge(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await call<FsReadResult>("fs.read", { relativePath: specPath });
        if (!cancelled) setBadge(derivePaneSpecBadge(res.content));
      } catch {
        if (!cancelled) setBadge(null); // deleted or unreadable
      }
    };
    void load();
    const off = onEvent((ev) => {
      if (ev.event !== "fs.contentChanged") return;
      const paths = (ev.payload as { paths?: unknown } | null)?.paths;
      if (Array.isArray(paths) && paths.includes(specPath)) void load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [call, onEvent, specPath]);

  return { specPath, badge };
}
