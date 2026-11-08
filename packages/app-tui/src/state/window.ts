/** The slice of a long list to show so that `selected` stays visible, keeping it roughly centered. */
export function visibleWindow(total: number, selected: number, size: number): { start: number; end: number } {
  if (total <= size) return { start: 0, end: total };
  const start = Math.min(Math.max(0, selected - Math.floor(size / 2)), total - size);
  return { start, end: start + size };
}
