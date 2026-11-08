import { useI18n } from "../i18n/index.js";

type Props = {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  saving?: boolean;
  error?: string | null;
};

/**
 * The only 3-way (Save/Discard/Cancel) confirm in this app — every other
 * confirm here is a plain window.confirm() (2-way: proceed/cancel), which
 * can't express "save first". Clicking the overlay counts as Cancel (never
 * silently discards unsaved work), matching how AgentManager.tsx's overlay
 * click maps to its own safe default (onClose).
 */
export function UnsavedChangesModal({ onSave, onDiscard, onCancel, saving, error }: Props) {
  const { t } = useI18n();
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("flow.unsaved.title")}</h2>
        </div>
        <p>{t("flow.unsaved.body")}</p>
        {error && <p className="error">{error}</p>}
        <div className="agent-form-actions">
          <button type="button" onClick={onCancel} disabled={saving}>
            {t("flow.unsaved.cancel")}
          </button>
          <button type="button" onClick={onDiscard} disabled={saving}>
            {t("flow.unsaved.discard")}
          </button>
          <button type="button" onClick={onSave} disabled={saving}>
            {saving ? t("flow.unsaved.saving") : t("flow.unsaved.saveContinue")}
          </button>
        </div>
      </div>
    </div>
  );
}
