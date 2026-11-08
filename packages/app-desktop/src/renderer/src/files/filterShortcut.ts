/** A filter box that wants the ⌘P shortcut. */
export type FilterBox = {
  id: number;
  /** Higher wins; the Documents tree outranks the sidebar's, so ⌘P in Documents searches notes. */
  priority: number;
  /** On screen right now (its tab is the active one). */
  visible: boolean;
};

/**
 * Every tab stays mounted, so several filter boxes can exist at once. ⌘P goes to the highest-priority
 * one that is actually showing; ties go to the one that registered first.
 */
export function pickFilterBox(boxes: FilterBox[]): number | undefined {
  let best: FilterBox | undefined;
  for (const box of boxes) {
    if (!box.visible) continue;
    if (!best || box.priority > best.priority) best = box;
  }
  return best?.id;
}
