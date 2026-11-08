/** The marker fields the status bar and problems panel use (monaco.editor.IMarker). */
export type MarkerLike = {
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  source?: string;
};

// monaco.MarkerSeverity, repeated so this file doesn't pull the editor into its tests.
export const SEVERITY_ERROR = 8;
export const SEVERITY_WARNING = 4;

export function countMarkers(markers: MarkerLike[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const marker of markers) {
    if (marker.severity === SEVERITY_ERROR) errors += 1;
    else if (marker.severity === SEVERITY_WARNING) warnings += 1;
  }
  return { errors, warnings };
}

/** Worst first, then in document order. */
export function sortMarkers<T extends MarkerLike>(markers: T[]): T[] {
  return [...markers].sort(
    (a, b) => b.severity - a.severity || a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn,
  );
}
