import { useState } from "react";
import { createPortal } from "react-dom";
import { BranchIcon } from "../files/FileIcons.js";
import { useI18n } from "../i18n/index.js";

/**
 * Icon-only branch chip for a pane's header. The name goes in a portaled tooltip
 * because .terminal-pane clips its overflow, which would cut a long name in a
 * narrow pane. A plain span on purpose: the header is draggable and must stay free
 * of focusable controls (see the dragstart note in TerminalPane.tsx).
 */
export function PaneBranchChip({ branch }: { branch: string }) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const label = t("term.pane.branch", { branch });

  return (
    <>
      <span
        className="terminal-pane-branch"
        role="img"
        aria-label={label}
        onMouseEnter={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setAnchor(null)}
        // A drag of the header never fires mouseleave, which would leave the tooltip behind.
        onMouseDown={() => setAnchor(null)}
      >
        <BranchIcon />
      </span>
      {anchor &&
        createPortal(
          <div
            className="terminal-branch-tip"
            role="tooltip"
            style={{
              top: anchor.bottom + 6,
              right: window.innerWidth - anchor.right,
              maxWidth: anchor.right - 8,
            }}
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
