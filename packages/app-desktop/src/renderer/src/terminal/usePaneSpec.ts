import { useEffect, useState, useSyncExternalStore } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { FsReadResult } from "../types.js";
import { featureTitle } from "../documents/featureDoc.js";
import { derivePaneSpecBadge, type PaneSpecBadge } from "./paneSpecBadge.js";

// pane id -> project-relative feature doc path, fed by main's "pane:spec" event
// (write_pane with specPath). Module-level so a pane that is minimized or
// remounted by layout changes still knows its doc; session-only like the ptys.
const specs = new Map<string, string>();
// The most recently handed-out doc: the Terminal tab's header shows this one.
let latestSpec: string | null = null;
const listeners = new Set<() => void>();
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed || typeof window === "undefined" || !window.yggdrasil?.terminals?.onSpec) return;
  subscribed = true;
  window.yggdrasil.terminals.onSpec((paneId, specPath) => {
    if (specs.get(paneId) === specPath) return;
    specs.set(paneId, specPath);
    latestSpec = specPath;
    listeners.forEach((fn) => fn());
  });
}
ensureSubscribed();

function subscribe(fn: () => void): () => void {
  ensureSubscribed();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Live status/progress/title of a feature doc: re-read when the doc changes on disk, so an agent ticking a task shows up without a refresh. `badge` is null until read, and again if the doc is deleted. */
export function useSpecSummary(specPath: string | null): { badge: PaneSpecBadge | null; title: string | null } {
  const { call, onEvent } = useGateway();
  const [summary, setSummary] = useState<{ badge: PaneSpecBadge | null; title: string | null }>({ badge: null, title: null });

  useEffect(() => {
    if (!specPath) {
      setSummary({ badge: null, title: null });
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await call<FsReadResult>("fs.read", { relativePath: specPath });
        if (!cancelled) setSummary({ badge: derivePaneSpecBadge(res.content), title: featureTitle(res.content) });
      } catch {
        if (!cancelled) setSummary({ badge: null, title: null }); // deleted or unreadable
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

  return summary;
}

/** The feature doc a pane was handed (write_pane/create_pane specPath) and its live status chip. */
export function usePaneSpec(paneId: string, seed?: string): { specPath: string | null; badge: PaneSpecBadge | null } {
  const specPath = useSyncExternalStore(subscribe, () => specs.get(paneId) ?? seed ?? null);
  const { badge } = useSpecSummary(specPath);
  return { specPath, badge };
}

/** The most recently handed-out feature doc in this window, for the Terminal header. */
export function useLatestSpecPath(): string | null {
  return useSyncExternalStore(subscribe, () => latestSpec);
}
