import { useWindowSize } from "ink";

export type TerminalSize = {
  columns: number;
  rows: number;
};

/** Current terminal size; re-renders on resize (Ink tracks it, so no manual stdout listener). */
export function useTerminalSize(): TerminalSize {
  const { columns, rows } = useWindowSize();
  return { columns, rows };
}
