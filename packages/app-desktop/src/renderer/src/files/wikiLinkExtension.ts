import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { detectWikiTrigger } from "./wikiLink.js";

/** An open `[[query` at the cursor: the range it occupies (the `[[` and what was typed), the query and the picker's state. */
export type WikiState = {
  from: number;
  to: number;
  query: string;
  /** Index of the highlighted item in the picker (clamped to the list by whoever draws it). */
  selected: number;
  /** Esc closed the picker; it stays closed until the trigger changes or goes away. */
  dismissed: boolean;
} | null;

type WikiMeta = { selected?: number; dismiss?: boolean };

export const wikiLinkKey = new PluginKey<WikiState>("wikiLink");

export function getWikiState(state: EditorState): WikiState | undefined {
  return wikiLinkKey.getState(state);
}

/**
 * Looks at the text before the cursor in the current text block. Not inside a code block or inline code, and only
 * for a cursor, never a range selection. A leaf node (hard break, image) counts as one character so offsets in
 * the text line up with positions in the document.
 */
export function computeWikiState(state: EditorState, prev: WikiState, meta?: WikiMeta): WikiState {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  const parent = $from.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  if ($from.marks().some((mark) => mark.type.name === "code")) return null;

  const textBefore = parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const trigger = detectWikiTrigger(textBefore);
  if (!trigger) return null;

  const from = $from.start() + trigger.start;
  const same = prev !== null && prev.from === from;
  return {
    from,
    to: $from.pos,
    query: trigger.query,
    selected: meta?.selected ?? (same ? prev.selected : 0),
    dismissed: meta?.dismiss ? true : same ? prev.dismissed : false,
  };
}

/** Tracks the open `[[` trigger; the picker UI (WikiLinkPopup) reads it and does the rest. */
export const WikiLink = Extension.create({
  name: "wikiLink",

  addProseMirrorPlugins() {
    return [
      new Plugin<WikiState>({
        key: wikiLinkKey,
        state: {
          init: () => null,
          apply: (tr, prev, _old, newState) => computeWikiState(newState, prev, tr.getMeta(wikiLinkKey) as WikiMeta | undefined),
        },
      }),
    ];
  },
});
