import type { SaveStatus } from "./autosave.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  status: SaveStatus;
  /** Offered when a save failed. */
  onRetry: () => void;
};

/** The save state in the editor's status bar: a dot and a short phrase, plus Retry after a failure. */
export function SaveIndicator({ status, onRetry }: Props) {
  const { t } = useI18n();
  if (!status.message) return null;
  return (
    <span className={`save-indicator ${status.tone}`} role="status">
      <i aria-hidden="true" />
      <span>{t(status.message.key, status.message.vars)}</span>
      {status.tone === "error" && (
        <button type="button" onClick={onRetry}>
          {t("doc.retry")}
        </button>
      )}
    </span>
  );
}
