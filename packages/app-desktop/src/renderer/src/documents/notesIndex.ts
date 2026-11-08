/** Mirrors the gateway's `documents.index` result (separate copies on each side of the process boundary). */
export type NoteLink = { target: string; line: number; text: string };
export type NoteInfo = { path: string; title: string; links: NoteLink[] };

/** A note that links to the one being read, with the line it was written on. */
export type Backlink = { path: string; title: string; line: number; text: string };

/** A note offered by the `[[` picker. */
export type WikiItem = { path: string; title: string; folder: string };

export type NotesIndex = Map<string, NoteInfo>;

/**
 * Folds a gateway answer into the index. A full answer (no `requested`) replaces everything; a partial one
 * replaces just the requested paths, so a note that was asked for and didn't come back (deleted, renamed away)
 * leaves the index.
 */
export function mergeIndex(index: NotesIndex, notes: NoteInfo[], requested?: string[]): NotesIndex {
  const next: NotesIndex = requested ? new Map(index) : new Map();
  for (const path of requested ?? []) next.delete(path);
  for (const note of notes) next.set(note.path, note);
  return next;
}

/** Every link, in every other note, that points at `path`, ordered by the linking note's title then line. */
export function buildBacklinks(index: NotesIndex, path: string): Backlink[] {
  const found: Backlink[] = [];
  for (const note of index.values()) {
    if (note.path === path) continue;
    for (const link of note.links) {
      if (link.target === path) found.push({ path: note.path, title: note.title, line: link.line, text: link.text });
    }
  }
  return found.sort((a, b) => a.title.localeCompare(b.title) || a.line - b.line);
}

/** The notes the picker offers: all of them but the open one, with their folder, alphabetically by title. */
export function wikiItems(index: NotesIndex, exceptPath?: string): WikiItem[] {
  const items: WikiItem[] = [];
  for (const note of index.values()) {
    if (note.path === exceptPath) continue;
    const slash = note.path.lastIndexOf("/");
    items.push({ path: note.path, title: note.title, folder: slash === -1 ? "" : note.path.slice(0, slash) });
  }
  return items.sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path));
}
