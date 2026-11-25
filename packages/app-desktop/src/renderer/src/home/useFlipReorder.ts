import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const DURATION_MS = 380;
const EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * FLIP reorder animation for a container whose children carry `data-flip-id`.
 * After each commit where `orderKey` changed, every child that moved slides
 * from its previous position to the new one (and new children fade in),
 * instead of jumping. Positions are re-measured after every reorder and on
 * window resize, so a resize alone never replays a stale slide.
 */
type Pos = { left: number; top: number };

/** Positions relative to the container, so scrolling between two measures doesn't read as movement. */
function measureChildren(container: HTMLElement) {
  const origin = container.getBoundingClientRect();
  const els = [...container.querySelectorAll<HTMLElement>("[data-flip-id]")];
  const positions = new Map<string, Pos>(
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return [el.dataset.flipId!, { left: r.left - origin.left, top: r.top - origin.top }];
    }),
  );
  return { els, positions };
}

export function useFlipReorder(containerRef: RefObject<HTMLElement | null>, orderKey: string) {
  const rects = useRef(new Map<string, Pos>());

  const measure = () => {
    const container = containerRef.current;
    if (container) rects.current = measureChildren(container).positions;
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const prev = rects.current;
    // Measure the new layout before starting any animation: once a transform
    // is applied, getBoundingClientRect would report the old position.
    const { els, positions: next } = measureChildren(container);
    rects.current = next;
    if (prev.size === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const el of els) {
      const before = prev.get(el.dataset.flipId!);
      const after = next.get(el.dataset.flipId!)!;
      if (!before) {
        el.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], {
          duration: DURATION_MS,
          easing: EASING,
        });
        continue;
      }
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: DURATION_MS,
        easing: EASING,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only an order change should replay the slide
  }, [orderKey]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
