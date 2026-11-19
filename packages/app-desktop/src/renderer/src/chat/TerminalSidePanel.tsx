import type { CSSProperties, ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { TerminalMirror } from "../terminal/TerminalMirror.js";
import { useTerminalPanes } from "../terminal/terminalPanesStore.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  paneId: string;
  onClose: () => void;
  /** Jump to the real, interactive pane in the Terminal tab. */
  onGoToPane: () => void;
  headerActions?: ReactNode;
  tabStrip?: ReactNode;
  style?: CSSProperties;
  className?: string;
};

/**
 * A live terminal pane beside the chat: a second, typeable view of the same pty. TerminalMirror never
 * resizes it, so showing it here can't reflow the pane in the Terminal tab.
 */
export function TerminalSidePanel({ paneId, onClose, onGoToPane, headerActions, tabStrip, style, className }: Props) {
  const { t } = useI18n();
  const { panes } = useTerminalPanes();
  const pane = panes.find((p) => p.id === paneId);
  return (
    <aside className={`file-content-panel${className ? ` ${className}` : ""}`} style={style}>
      {tabStrip}
      <div className="file-content-panel-header">
        <div className="file-content-panel-title">
          <span className="file-content-panel-path" title={pane?.cwd}>
            {pane?.title ?? paneId}
          </span>
          <button type="button" className="icon-btn panel-goto" onClick={onGoToPane}>
            {t("chat.panel.goToTerminal")}
          </button>
        </div>
        {headerActions}
        <button type="button" className="icon-btn" onClick={onClose} title={t("doc.close")}>
          <XMarkIcon className="hero-icon" />
        </button>
      </div>
      <div className="file-content-panel-body panel-terminal-body">
        {pane ? <TerminalMirror key={paneId} id={paneId} interactive /> : <p className="muted">{t("chat.panel.terminalGone")}</p>}
      </div>
    </aside>
  );
}
