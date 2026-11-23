import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

// Widths of the Repositorio tab's three columns (branches rail, changes, diff).
// The user drags the two borders; what's stored is their preferred width, and
// what's drawn is that width fitted to the minimums for the current window:
// rail ≥ 180px, changes ≥ 30%, diff ≥ 30% (≥ 50% in split mode, so both sides
// stay readable). Going back to unified gives the stored widths back.

export const RAIL_MIN_PX = 180;
export const CENTER_MIN = 0.3;
export const DIFF_MIN = 0.3;
export const DIFF_MIN_SPLIT = 0.5;
const DEFAULTS = { rail: 248, center: 400 };
const KEY = "ygg.repo.columns";

export type Columns = { rail: number; center: number };

/**
 * Fits the preferred widths into `width` (the row minus the handles). When the
 * diff lacks room, the rail gives way first (down to its minimum), then the
 * changes column (down to 30%). A window too narrow for every minimum squeezes
 * the rail below its own.
 */
export function fitColumns(preferred: Columns, width: number, split: boolean): Columns {
  if (width <= 0) return preferred;
  const minCenter = CENTER_MIN * width;
  const maxSides = width - (split ? DIFF_MIN_SPLIT : DIFF_MIN) * width;
  let center = Math.max(preferred.center, minCenter);
  let rail = Math.max(preferred.rail, RAIL_MIN_PX);
  if (rail + center > maxSides) rail = Math.max(RAIL_MIN_PX, maxSides - center);
  if (rail + center > maxSides) center = Math.max(minCenter, maxSides - rail);
  if (rail + center > maxSides) rail = Math.max(0, maxSides - center);
  return { rail: Math.round(rail), center: Math.round(center) };
}

function read(): Columns {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Columns> | null;
    if (v && Number.isFinite(v.rail) && Number.isFinite(v.center)) return { rail: v.rail!, center: v.center! };
  } catch {
    // storage unavailable or garbage: defaults
  }
  return DEFAULTS;
}

function write(c: Columns): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // won't persist
  }
}

const HANDLE_PX = 6;
const KEY_STEP = 24;

/**
 * State + handle props for the two borders. `rowRef` goes on the .repo-body
 * element: a callback ref, since that row only appears once the repos load.
 */
export function useRepoColumns(split: boolean) {
  const [preferred, setPreferred] = useState<Columns>(read);
  const [rowWidth, setRowWidth] = useState(0);
  const [row, rowRef] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = row;
    if (!el) return;
    const ro = new ResizeObserver(() => setRowWidth(el.clientWidth));
    ro.observe(el);
    setRowWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [row]);

  const width = Math.max(0, rowWidth - 2 * HANDLE_PX);
  const fitted = fitColumns(preferred, width, split);
  const latest = useRef({ fitted, width, split });
  latest.current = { fitted, width, split };

  const commit = useCallback((next: Columns) => {
    const { width: w, split: s } = latest.current;
    // Store what the user can actually see, so a drag past a minimum doesn't leave a hidden preference behind.
    const fit = w > 0 ? fitColumns(next, w, s) : next;
    setPreferred(fit);
    write(fit);
  }, []);

  const handle = (which: "rail" | "center") => ({
    role: "separator" as const,
    "aria-orientation": "vertical" as const,
    tabIndex: 0,
    className: "repo-resizer",
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const start = latest.current.fitted;
      const move = (ev: globalThis.PointerEvent) => {
        const dx = ev.clientX - startX;
        commit(which === "rail" ? { ...start, rail: start.rail + dx } : { ...start, center: start.center + dx });
      };
      const up = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        target.removeEventListener("pointercancel", up);
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
      target.addEventListener("pointercancel", up);
    },
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      const dx = e.key === "ArrowLeft" ? -KEY_STEP : e.key === "ArrowRight" ? KEY_STEP : 0;
      if (!dx) return;
      e.preventDefault();
      const cur = latest.current.fitted;
      commit(which === "rail" ? { ...cur, rail: cur.rail + dx } : { ...cur, center: cur.center + dx });
    },
  });

  return { rowRef, rail: fitted.rail, center: fitted.center, railHandle: handle("rail"), centerHandle: handle("center") };
}
