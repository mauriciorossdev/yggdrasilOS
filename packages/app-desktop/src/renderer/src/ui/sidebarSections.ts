/**
 * Which sidebar sections the user left open, remembered per project in
 * localStorage (the same place sidebarStore.ts keeps the collapsed/expanded
 * sidebar). A section nobody has toggled yet falls back to its own default.
 * Everything tolerates a missing or throwing storage: private windows and
 * blocked site data are valid states, the sidebar just starts at its defaults.
 */
type StorageLike = Pick<Storage, "getItem" | "setItem">;

const PREFIX = "ygg.sidebar.sections.";

function storageKey(projectKey: string): string {
  return `${PREFIX}${projectKey}`;
}

/** The saved open/closed state of every toggled section of a project. */
export function loadSectionStates(storage: StorageLike | undefined, projectKey: string): Record<string, boolean> {
  try {
    const raw = storage?.getItem(storageKey(projectKey));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const states: Record<string, boolean> = {};
    for (const [id, open] of Object.entries(parsed)) if (typeof open === "boolean") states[id] = open;
    return states;
  } catch {
    return {};
  }
}

/** Remembers one section's state without touching the others. */
export function saveSectionState(storage: StorageLike | undefined, projectKey: string, id: string, open: boolean): void {
  try {
    const next = { ...loadSectionStates(storage, projectKey), [id]: open };
    storage?.setItem(storageKey(projectKey), JSON.stringify(next));
  } catch {
    // Nothing to do: the toggle still works, it just isn't remembered.
  }
}

/** Open state to start a section with: what was saved, else the section's default. */
export function initialSectionOpen(
  storage: StorageLike | undefined,
  projectKey: string,
  id: string | undefined,
  defaultOpen: boolean,
): boolean {
  if (!id) return defaultOpen;
  return loadSectionStates(storage, projectKey)[id] ?? defaultOpen;
}
