import type { WorkspaceAction, WorkspaceGraph } from "../types.js";

/**
 * Pure helpers behind the Workspaces canvas (WorkspacesCanvas.tsx): turn the
 * directional link map into one connection per project pair, and read the
 * trust that applies to each direction. See notes/features/workspaces-canvas.md.
 */

/** One line on the canvas: `a` < `b` (stable key); `ab` = a→b is linked, `ba` = b→a is linked. */
export type ProjectPair = { key: string; a: string; b: string; ab: boolean; ba: boolean };

export function pairKey(x: string, y: string): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

/** Every linked pair once, whichever direction(s) the links go. */
export function pairsFromLinks(links: WorkspaceGraph["links"]): ProjectPair[] {
  const pairs = new Map<string, ProjectPair>();
  for (const [from, targets] of Object.entries(links)) {
    for (const to of targets) {
      if (to === from) continue;
      const key = pairKey(from, to);
      const [a, b] = from < to ? [from, to] : [to, from];
      const pair = pairs.get(key) ?? { key, a, b, ab: false, ba: false };
      if (from === a) pair.ab = true;
      else pair.ba = true;
      pairs.set(key, pair);
    }
  }
  return [...pairs.values()];
}

export function isTrusted(trust: string[], from: string, to: string, action: WorkspaceAction): boolean {
  return trust.includes(`${from}>${to}:${action}`);
}

/** Any trust in either direction between the two — drawn as a marker on the line, and asked about before disconnecting. */
export function pairHasTrust(trust: string[], a: string, b: string): boolean {
  return trust.some((k) => k.startsWith(`${a}>${b}:`) || k.startsWith(`${b}>${a}:`));
}

const GRID_COLS = 4;
const GRID_X = 240;
const GRID_Y = 140;

/** Where a project with no saved position goes: a grid below the ones that have one. */
export function defaultPosition(index: number, layout: WorkspaceGraph["layout"]): { x: number; y: number } {
  const placedBottom = Object.values(layout).reduce((max, p) => Math.max(max, p.y), -Infinity);
  const top = Number.isFinite(placedBottom) ? placedBottom + GRID_Y : 0;
  return { x: (index % GRID_COLS) * GRID_X, y: top + Math.floor(index / GRID_COLS) * GRID_Y };
}

/** The latest cross-project actions between two projects (audit entries carry names), newest first. */
export function pairAudit(audit: WorkspaceGraph["audit"], nameA: string, nameB: string, limit = 5): WorkspaceGraph["audit"] {
  return audit
    .filter((e) => (e.from === nameA && e.to === nameB) || (e.from === nameB && e.to === nameA))
    .slice(-limit)
    .reverse();
}

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Where the straight line from `rect`'s center toward `other`'s center leaves
 * `rect`'s border. Lines on the Workspaces canvas run border to border along
 * that line ("floating" edges) instead of from fixed handles, so they never
 * loop around a node to reach a handle on its far side.
 */
export function borderPoint(rect: Rect, other: Rect): { x: number; y: number } {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = other.x + other.width / 2 - cx;
  const dy = other.y + other.height / 2 - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  // Scale the direction until it hits the nearer of the vertical/horizontal sides.
  const sx = dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Projects whose center lies inside the zone — the ones that move with it. Membership is purely positional. */
export function projectsInZone(zone: Rect, projects: Array<{ id: string } & Rect>): string[] {
  return projects
    .filter((p) => {
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      return cx >= zone.x && cx <= zone.x + zone.width && cy >= zone.y && cy <= zone.y + zone.height;
    })
    .map((p) => p.id);
}

/** Preset zone colors (any #rrggbb is accepted too). */
export const ZONE_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#a855f7", "#ec4899", "#6b7280"];

/** The rectangle a drag from `a` to `b` covers, whichever direction it went. */
export function rectFromDrag(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}
