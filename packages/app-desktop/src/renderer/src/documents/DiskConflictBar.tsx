import { useI18n } from "../i18n/index.js";

type Props = { onLoadDisk: () => void; onKeepMine: () => void };

/** Shown when a file changed on disk while its editor holds unsaved edits (see reconcileExternalChange.ts) — shared by DocumentsView tabs and FileContentPanel. */
export function DiskConflictBar({ onLoadDisk, onKeepMine }: Props) {
  const { t } = useI18n();
  return (
    <div className="documents-conflict-bar" role="alert">
      <span>{t("docs.conflict.message")}</span>
      <button type="button" onClick={onLoadDisk}>
        {t("docs.conflict.loadDisk")}
      </button>
      <button type="button" onClick={onKeepMine}>
        {t("docs.conflict.keepMine")}
      </button>
    </div>
  );
}
