import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { getSearchState } from "./searchReplace.js";
import { useEditorTick } from "./useEditorTick.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  editor: Editor;
  /** What to start looking for (the selected text, or a search result's query). */
  initialQuery?: string;
  readOnly?: boolean;
  onClose: () => void;
};

/** Find and replace inside the rich editor: Enter / Shift+Enter step through the matches, Escape closes. */
export function FindBar({ editor, initialQuery = "", readOnly, onClose }: Props) {
  const { t } = useI18n();
  useEditorTick(editor);
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const queryRef = useRef<HTMLInputElement>(null);

  const search = getSearchState(editor.state);
  const count = search?.matches.length ?? 0;

  // Start from the seed, and leave no highlights behind when the bar goes away.
  useEffect(() => {
    queryRef.current?.focus();
    queryRef.current?.select();
    if (initialQuery) editor.commands.setSearchQuery(initialQuery, false);
    return () => {
      editor.commands.clearSearch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const run = (next: string, cs: boolean) => editor.commands.setSearchQuery(next, cs);

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  const onQueryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      editor.commands.searchStep(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const onReplaceKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!readOnly) editor.commands.replaceCurrent(replacement);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const status = !query ? "" : count === 0 ? t("doc.find.noResults") : t("doc.find.count", { current: (search?.current ?? 0) + 1, total: count });

  return (
    <div className="find-bar" role="search">
      <div className="find-bar-row">
        <input
          ref={queryRef}
          type="text"
          value={query}
          placeholder={t("doc.find.placeholder")}
          aria-label={t("doc.find.placeholder")}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            run(e.target.value, caseSensitive);
          }}
          onKeyDown={onQueryKeyDown}
        />
        <span className="find-bar-count" aria-live="polite">
          {status}
        </span>
        <button
          type="button"
          className={`find-bar-case${caseSensitive ? " on" : ""}`}
          title={t("doc.find.case")}
          aria-label={t("doc.find.case")}
          aria-pressed={caseSensitive}
          onClick={() => {
            setCaseSensitive(!caseSensitive);
            run(query, !caseSensitive);
          }}
        >
          Aa
        </button>
        <button type="button" title={t("doc.find.prevTitle")} aria-label={t("doc.find.prev")} disabled={count === 0} onClick={() => editor.commands.searchStep(-1)}>
          <ChevronUpIcon className="hero-icon" />
        </button>
        <button type="button" title={t("doc.find.nextTitle")} aria-label={t("doc.find.next")} disabled={count === 0} onClick={() => editor.commands.searchStep(1)}>
          <ChevronDownIcon className="hero-icon" />
        </button>
        {!readOnly && (
          <button
            type="button"
            className={replaceOpen ? "on" : ""}
            title={t("doc.find.replace")}
            aria-label={t("doc.find.showReplace")}
            aria-pressed={replaceOpen}
            onClick={() => setReplaceOpen(!replaceOpen)}
          >
            ⇄
          </button>
        )}
        <button type="button" title={t("doc.find.closeTitle")} aria-label={t("doc.close")} onClick={close}>
          <XMarkIcon className="hero-icon" />
        </button>
      </div>
      {replaceOpen && !readOnly && (
        <div className="find-bar-row">
          <input
            type="text"
            value={replacement}
            placeholder={t("doc.find.replaceWith")}
            aria-label={t("doc.find.replaceWith")}
            spellCheck={false}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={onReplaceKeyDown}
          />
          <button type="button" className="find-bar-text" disabled={count === 0} onClick={() => editor.commands.replaceCurrent(replacement)}>
            {t("doc.find.replace")}
          </button>
          <button type="button" className="find-bar-text" disabled={count === 0} onClick={() => editor.commands.replaceAll(replacement)}>
            {t("doc.find.replaceAll")}
          </button>
        </div>
      )}
    </div>
  );
}
