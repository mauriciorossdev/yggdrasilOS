import type { PaneSummary } from "../types.js";
import type { LeafPane } from "./paneTree.js";

/**
 * Live panes (main's registry, via panes.list) that this window has no leaf
 * for, as attach leaves ready for the ADOPT_LIVE action. The pty already
 * exists, so TerminalPane attaches to it instead of spawning another.
 */
export function liveOrphans(leaves: LeafPane[], live: PaneSummary[]): LeafPane[] {
  const known = new Set(leaves.map((l) => l.id));
  return live
    .filter((p) => !known.has(p.id))
    .map((p) => ({ type: "leaf", id: p.id, title: p.title, cwd: p.cwd, command: p.command, attach: true }));
}
