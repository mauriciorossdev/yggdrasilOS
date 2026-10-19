type Props = { onLoadDisk: () => void; onKeepMine: () => void };

/** Shown when a file changed on disk while its editor holds unsaved edits (see reconcileExternalChange.ts) — shared by DocumentsView tabs and FileContentPanel. */
export function DiskConflictBar({ onLoadDisk, onKeepMine }: Props) {
  return (
    <div className="documents-conflict-bar" role="alert">
      <span>This file changed on disk while you have unsaved edits.</span>
      <button type="button" onClick={onLoadDisk}>
        Load disk version
      </button>
      <button type="button" onClick={onKeepMine}>
        Keep mine
      </button>
    </div>
  );
}
