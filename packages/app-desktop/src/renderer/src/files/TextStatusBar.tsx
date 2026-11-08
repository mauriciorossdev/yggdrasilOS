import { useDeferredValue, useMemo, type ReactNode } from "react";
import { countWords, readingMinutes } from "./textStats.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  /** The document's markdown, for the word count and reading time. */
  value: string;
  previewing: boolean;
  onModeChange: (previewing: boolean) => void;
  /** Where the host shows the save state (Documents does; the Files tab has none). */
  status?: ReactNode;
};

/** Words, reading time, an optional save state, and the Rica / Código switch. */
export function TextStatusBar({ value, previewing, onModeChange, status }: Props) {
  const { t } = useI18n();
  const deferred = useDeferredValue(value);
  const words = useMemo(() => countWords(deferred), [deferred]);
  const minutes = readingMinutes(words);

  return (
    <div className="text-status-bar">
      <span>{words.toLocaleString()} {words === 1 ? t("doc.status.word") : t("doc.status.words")}</span>
      {minutes > 0 && <span>{t("doc.status.readMin", { minutes })}</span>}
      <span className="text-status-spacer" />
      {status}
      <span className="text-status-seg" role="group" aria-label={t("doc.status.mode")}>
        <button type="button" className={previewing ? "on" : ""} aria-pressed={previewing} onClick={() => onModeChange(true)}>
          {t("doc.status.rich")}
        </button>
        <button type="button" className={previewing ? "" : "on"} aria-pressed={!previewing} onClick={() => onModeChange(false)}>
          {t("doc.status.code")}
        </button>
      </span>
    </div>
  );
}
