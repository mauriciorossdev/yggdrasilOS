import { useCallback, useMemo, useRef, useState } from "react";
import { CheckIcon } from "@heroicons/react/20/solid";
import { useDismiss } from "../ui/index.js";
import { useI18n } from "../i18n/index.js";
import { SettingsView } from "../settings/SettingsView.js";
import { agoParts, pendingItems, useAttention, type AttentionItem } from "../terminal/attentionStore.js";
import { requestFocusPane, useTerminalPanes } from "../terminal/terminalPanesStore.js";

/**
 * Title-bar counter of claude panes that need the user ("2 waiting · 1 done"),
 * visible from any tab. Opens a list; picking a pane brings it to front
 * (Terminal tab, restored if minimized, focused). Hidden when nothing is
 * pending. See notes/features/attention-inbox.md.
 */
export function AttentionCounter() {
  const { t } = useI18n();
  const states = useAttention();
  const { panes } = useTerminalPanes();
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, close, open);

  const byId = useMemo(() => new Map(panes.map((p) => [p.id, p])), [panes]);
  const { waiting, done } = useMemo(() => pendingItems(states, new Set(byId.keys())), [states, byId]);

  if (waiting.length === 0 && done.length === 0) {
    return showSettings ? <SettingsView initialSection="cliAgents" onClose={() => setShowSettings(false)} /> : null;
  }

  const go = (id: string) => {
    setOpen(false);
    requestFocusPane(id);
  };

  const item = ({ id, state }: AttentionItem) => {
    const pane = byId.get(id);
    const ago = agoParts(state.since, Date.now());
    const waitingItem = state.status === "waiting";
    return (
      <button key={id} type="button" className="attention-item" onClick={() => go(id)}>
        {waitingItem ? (
          <span className="attention-item-dot" aria-hidden />
        ) : (
          <CheckIcon className="hero-icon attention-item-check" aria-hidden />
        )}
        <span className="attention-item-body">
          <span className="attention-item-head">
            <span className="attention-item-title">
              {pane?.title ?? id}
              {pane?.minimized && <span className="attention-item-note"> {t("attn.minimized")}</span>}
            </span>
            <span className="attention-item-ago">{t(ago.key, { n: ago.n })}</span>
          </span>
          <span className="attention-item-message">
            {waitingItem ? (state.message ?? t("attn.waitingFallback")) : t("attn.doneBody")}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="attention-counter" ref={ref}>
      <button
        type="button"
        className={`attention-counter-btn${waiting.length > 0 ? " has-waiting" : ""}${open ? " open" : ""}`}
        aria-expanded={open}
        title={t("attn.counterTitle", { waiting: waiting.length, done: done.length })}
        onClick={() => setOpen((v) => !v)}
      >
        {waiting.length > 0 && (
          <span className="attention-counter-waiting">
            <span className="attention-counter-dot" aria-hidden />
            {waiting.length === 1 ? t("attn.counterWaitingOne") : t("attn.counterWaiting", { count: waiting.length })}
          </span>
        )}
        {waiting.length > 0 && done.length > 0 && <span className="attention-counter-sep" aria-hidden />}
        {done.length > 0 && (
          <span className="attention-counter-done">
            <CheckIcon className="hero-icon" aria-hidden />
            {done.length === 1 ? t("attn.counterDoneOne") : t("attn.counterDone", { count: done.length })}
          </span>
        )}
      </button>

      {open && (
        <div className="attention-list" role="dialog" aria-label={t("attn.listTitle")}>
          {waiting.length > 0 && (
            <>
              <div className="attention-section attention-section--waiting">
                {t("attn.sectionWaiting", { count: waiting.length })}
              </div>
              {waiting.map(item)}
            </>
          )}
          {waiting.length > 0 && done.length > 0 && <div className="attention-divider" />}
          {done.length > 0 && (
            <>
              <div className="attention-section attention-section--done">{t("attn.sectionDone", { count: done.length })}</div>
              {done.map(item)}
            </>
          )}
          <div className="attention-footer">
            <button
              type="button"
              className="attention-footer-btn"
              disabled={done.length === 0}
              onClick={() => void window.yggdrasil.attention.clearDone()}
            >
              {t("attn.clearDone")}
            </button>
            <button
              type="button"
              className="attention-footer-link"
              onClick={() => {
                setOpen(false);
                setShowSettings(true);
              }}
            >
              {t("attn.settings")}
            </button>
          </div>
        </div>
      )}
      {showSettings && <SettingsView initialSection="cliAgents" onClose={() => setShowSettings(false)} />}
    </div>
  );
}
