import { useCallback, useEffect, useRef, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { mergeIndex, type NoteInfo, type NotesIndex } from "./notesIndex.js";

const PARTIAL_DELAY_MS = 400;
const FULL_DELAY_MS = 1500;
const NOTE_FILE = /\.(md|markdown)$/i;

/**
 * Titles and note-to-note links for everything under `root`, kept current: calculated once the view is ready,
 * then updated per file when a note's content changes (an autosave, an agent editing it) and in full, a moment
 * later, when files are added, removed or renamed.
 */
export function useNotesIndex(root: string, ready: boolean): NotesIndex {
  const { call, onEvent, authenticated } = useGateway();
  const [index, setIndex] = useState<NotesIndex>(() => new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const partialTimer = useRef<number | undefined>(undefined);
  const fullTimer = useRef<number | undefined>(undefined);

  const load = useCallback(
    async (paths?: string[]) => {
      try {
        const res = await call<{ notes: NoteInfo[] }>("documents.index", { root, ...(paths ? { paths } : {}) });
        setIndex((prev) => mergeIndex(prev, res.notes, paths));
      } catch {
        // Without an index the picker and backlinks are simply empty; the editor doesn't depend on it.
      }
    },
    [call, root],
  );

  useEffect(() => {
    if (ready && authenticated) void load();
  }, [ready, authenticated, load]);

  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.event === "fs.contentChanged") {
          const paths = (ev.payload as { paths?: unknown } | null)?.paths;
          if (!Array.isArray(paths)) return;
          for (const p of paths) if (typeof p === "string" && p.startsWith(`${root}/`) && NOTE_FILE.test(p)) pendingRef.current.add(p);
          if (pendingRef.current.size === 0) return;
          window.clearTimeout(partialTimer.current);
          partialTimer.current = window.setTimeout(() => {
            const batch = [...pendingRef.current];
            pendingRef.current.clear();
            void load(batch);
          }, PARTIAL_DELAY_MS);
        } else if (ev.event === "fs.changed") {
          window.clearTimeout(fullTimer.current);
          fullTimer.current = window.setTimeout(() => void load(), FULL_DELAY_MS);
        }
      }),
    [onEvent, load, root],
  );

  useEffect(
    () => () => {
      window.clearTimeout(partialTimer.current);
      window.clearTimeout(fullTimer.current);
    },
    [],
  );

  return index;
}
