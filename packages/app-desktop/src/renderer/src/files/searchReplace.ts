import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** A match in the rich editor's document: positions, like a selection's. */
export type MatchRange = { from: number; to: number };

type Segment = { start: number; len: number; docPos: number };

// Stands in for an inline node that isn't text (a hard break, an image): it takes one character
// of the block's text so offsets keep lining up with positions, and can't be part of a match.
const NON_TEXT = "￼";

function offsetToPos(segments: Segment[], offset: number): number {
  for (const s of segments) {
    if (offset >= s.start && offset < s.start + s.len) return s.docPos + (offset - s.start);
  }
  const last = segments[segments.length - 1];
  return last ? last.docPos + last.len : 0;
}

/**
 * Every occurrence of `query` in the document's text, found one text block at a time (so a match
 * never crosses a paragraph) but across the marks inside it: "**Qué** leer" matches "Qué leer".
 */
export function findInDoc(doc: PMNode, query: string, caseSensitive = false): MatchRange[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const ranges: MatchRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const segments: Segment[] = [];
    node.forEach((child, offset) => {
      const docPos = pos + 1 + offset;
      if (child.isText) {
        segments.push({ start: text.length, len: child.text!.length, docPos });
        text += child.text!;
      } else {
        segments.push({ start: text.length, len: 1, docPos });
        text += NON_TEXT;
      }
    });
    const haystack = caseSensitive ? text : text.toLowerCase();
    // Lowercasing can change a string's length for a few scripts; then offsets can't be trusted.
    if (haystack.length !== text.length) return false;
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
      ranges.push({ from: offsetToPos(segments, at), to: offsetToPos(segments, at + needle.length - 1) + 1 });
    }
    return false;
  });
  return ranges;
}

/** Replaces every range with `text`, last to first so earlier positions stay valid. */
export function replaceRanges(tr: Transaction, ranges: MatchRange[], text: string): Transaction {
  for (const range of [...ranges].sort((a, b) => b.from - a.from)) tr.insertText(text, range.from, range.to);
  return tr;
}

/** The match to land on when stepping forwards (+1) or back (-1), wrapping around. */
export function stepIndex(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return 0;
  return (current + direction + count) % count;
}

export type SearchState = {
  query: string;
  caseSensitive: boolean;
  /** Index into `matches` of the match the user is on. */
  current: number;
  matches: MatchRange[];
  decorations: DecorationSet;
};

type SearchMeta = { query?: string; caseSensitive?: boolean; current?: number };

export const searchReplaceKey = new PluginKey<SearchState>("searchReplace");

export function getSearchState(state: EditorState): SearchState | undefined {
  return searchReplaceKey.getState(state);
}

function buildState(doc: PMNode, query: string, caseSensitive: boolean, current: number): SearchState {
  const matches = findInDoc(doc, query, caseSensitive);
  const index = matches.length === 0 ? 0 : Math.min(Math.max(current, 0), matches.length - 1);
  const decorations = DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === index ? "search-match search-current" : "search-match" })),
  );
  return { query, caseSensitive, current: index, matches, decorations };
}

/** Highlights the matches of the current query and keeps them up to date as the document changes. */
export function createSearchPlugin(): Plugin<SearchState> {
  return new Plugin<SearchState>({
    key: searchReplaceKey,
    state: {
      init: (_config, state) => buildState(state.doc, "", false, 0),
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(searchReplaceKey) as SearchMeta | undefined;
        if (meta) {
          return buildState(newState.doc, meta.query ?? prev.query, meta.caseSensitive ?? prev.caseSensitive, meta.current ?? prev.current);
        }
        if (tr.docChanged && prev.query) return buildState(newState.doc, prev.query, prev.caseSensitive, prev.current);
        return prev;
      },
    },
    props: {
      decorations: (state) => getSearchState(state)?.decorations,
    },
  });
}

/** Selects a match (so the editor scrolls to it) without touching the document. */
function selectMatch(tr: Transaction, match: MatchRange | undefined): Transaction {
  if (!match) return tr;
  return tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchReplace: {
      /** Sets what to look for; jumps to the first match. An empty query clears the highlights. */
      setSearchQuery: (query: string, caseSensitive?: boolean) => ReturnType;
      /** Moves to the next (+1) or previous (-1) match, wrapping around. */
      searchStep: (direction: 1 | -1) => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

export const SearchReplace = Extension.create({
  name: "searchReplace",

  addProseMirrorPlugins() {
    return [createSearchPlugin()];
  },

  addCommands() {
    return {
      setSearchQuery:
        (query, caseSensitive = false) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(searchReplaceKey, { query, caseSensitive, current: 0 } satisfies SearchMeta);
            selectMatch(tr, findInDoc(tr.doc, query, caseSensitive)[0]);
          }
          return true;
        },
      searchStep:
        (direction) =>
        ({ tr, state, dispatch }) => {
          const search = getSearchState(state);
          if (!search || search.matches.length === 0) return false;
          if (dispatch) {
            const next = stepIndex(search.current, search.matches.length, direction);
            tr.setMeta(searchReplaceKey, { current: next } satisfies SearchMeta);
            selectMatch(tr, search.matches[next]);
          }
          return true;
        },
      replaceCurrent:
        (replacement) =>
        ({ tr, state, dispatch }) => {
          const search = getSearchState(state);
          const match = search?.matches[search.current];
          if (!search || !match) return false;
          if (dispatch) replaceRanges(tr, [match], replacement);
          return true;
        },
      replaceAll:
        (replacement) =>
        ({ tr, state, dispatch }) => {
          const search = getSearchState(state);
          if (!search || search.matches.length === 0) return false;
          if (dispatch) replaceRanges(tr, search.matches, replacement);
          return true;
        },
      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(searchReplaceKey, { query: "", current: 0 } satisfies SearchMeta);
          return true;
        },
    };
  },
});
