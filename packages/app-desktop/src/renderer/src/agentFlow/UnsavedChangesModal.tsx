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
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Unsaved changes</h2>
        </div>
        <p>This Agent Flow has unsaved changes. Save before starting a new one?</p>
        {error && <p className="error">{error}</p>}
        <div className="agent-form-actions">
          <button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={onDiscard} disabled={saving}>
            Discard
          </button>
          <button type="button" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save & Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
