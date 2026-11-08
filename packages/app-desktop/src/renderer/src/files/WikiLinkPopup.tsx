import { useCallback, useEffect, useMemo } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorTick } from "./useEditorTick.js";
import { getWikiState, wikiLinkKey } from "./wikiLinkExtension.js";
import { filterWikiItems, noteHref } from "./wikiLink.js";
import type { WikiItem } from "../documents/notesIndex.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  editor: Editor;
  items: WikiItem[];
  /** The open note's path: links are written relative to its folder. */
  notePath: string;
};

const POPUP_WIDTH = 320;
const POPUP_MAX_HEIGHT = 280;

/**
 * The list that opens at `[[`: notes matching what is typed, ↑↓ to move, Enter or Tab to link, Esc to close.
 * Choosing one replaces the `[[query` with a plain markdown link (`[Title](relative/path.md)`), so the link
 * works outside the app too.
 */
export function WikiLinkPopup({ editor, items, notePath }: Props) {
  const { t } = useI18n();
  useEditorTick(editor);
  const state = getWikiState(editor.state);
  const active = !!state && !state.dismissed;
  const query = state?.query ?? "";
  const matches = useMemo(() => (active ? filterWikiItems(items, query) : []), [active, items, query]);
  const selected = Math.min(state?.selected ?? 0, Math.max(matches.length - 1, 0));

  const pick = useCallback(
    (item: WikiItem) => {
      const range = getWikiState(editor.state);
      if (!range) return;
      editor
        .chain()
        .focus()
        .deleteRange({ from: range.from, to: range.to })
        .insertContent([
          { type: "text", text: item.title, marks: [{ type: "link", attrs: { href: noteHref(notePath, item.path) } }] },
          { type: "text", text: " " },
        ])
        .run();
    },
    [editor, notePath],
  );

  const setSelected = useCallback(
    (index: number) => editor.view.dispatch(editor.state.tr.setMeta(wikiLinkKey, { selected: index })),
    [editor],
  );

  // Keys are taken in the capture phase, before the editor sees them, only while the list is open.
  useEffect(() => {
    if (!active) return;
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        editor.view.dispatch(editor.state.tr.setMeta(wikiLinkKey, { dismiss: true }));
        return;
      }
      if (matches.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((selected + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        pick(matches[selected]!);
      }
    };
    dom.addEventListener("keydown", onKey, true);
    return () => dom.removeEventListener("keydown", onKey, true);
  }, [active, editor, matches, selected, pick, setSelected]);

  if (!active || !state) return null;

  const coords = editor.view.coordsAtPos(state.from);
  const left = Math.max(8, Math.min(coords.left, window.innerWidth - POPUP_WIDTH - 8));
  const below = coords.bottom + 6 + POPUP_MAX_HEIGHT <= window.innerHeight;
  const style = below ? { left, top: coords.bottom + 6 } : { left, bottom: window.innerHeight - coords.top + 6 };

  return (
    <div className="wiki-popup" style={style} role="listbox" aria-label={t("doc.wiki.label")}>
      <div className="wiki-popup-head">{t("doc.wiki.head")}</div>
      {matches.length === 0 ? (
        <div className="wiki-popup-empty">{t("doc.wiki.empty")}</div>
      ) : (
        matches.map((item, i) => (
          <div
            key={item.path}
            role="option"
            aria-selected={i === selected}
            className={`wiki-popup-item${i === selected ? " active" : ""}`}
            // mousedown, not click: the editor must keep its selection so the replacement lands on the right range.
            onMouseDown={(e) => {
              e.preventDefault();
              pick(item);
            }}
            onMouseEnter={() => i !== selected && setSelected(i)}
          >
            <span className="wiki-popup-title">{item.title}</span>
            <span className="wiki-popup-path">{item.path}</span>
          </div>
        ))
      )}
    </div>
  );
}
