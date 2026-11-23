import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useI18n, type MessageKey } from "../i18n/index.js";
import type { QueuedMessage, QueueSource } from "../types.js";
import { agoParts, usePaneAttention } from "./attentionStore.js";
import { usePaneQueue } from "./queueStore.js";

const SOURCE_KEY: Record<QueueSource["kind"], MessageKey> = {
  app: "queue.source.app",
  remote: "queue.source.remote",
  orchestrator: "queue.source.orchestrator",
  review: "queue.source.review",
  browser: "queue.source.browser",
  workspace: "queue.source.workspace",
  plugin: "queue.source.plugin",
};

/**
 * A claude pane's message queue in its header: "2 en cola" (or "En pausa"),
 * opening the list: what goes in next, where each message came from, and
 * send now / edit / reorder / delete, plus a field to queue the next message.
 * Hidden while the queue is empty. See notes/features/pane-message-queue.md.
 */
export function QueueChip({ paneId }: { paneId: string }) {
  const { t } = useI18n();
  const queue = usePaneQueue(paneId);
  const attention = usePaneAttention(paneId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  const close = useCallback(() => {
    setOpen(false);
    setEditing(null);
    setConfirmId(null);
  }, []);

  // The list lives in a portal: the pane clips its own overflow, and a pane on
  // the right edge would cut a list that opens toward the left.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const place = () => {
      const r = ref.current!.getBoundingClientRect();
      const width = Math.min(380, window.innerWidth - 16);
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      setPos({ position: "fixed", top: r.bottom + 6, left, width });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !popRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (!queue || (queue.items.length === 0 && !queue.paused)) return null;
  const count = queue.items.length;
  const waiting = attention?.status === "waiting";

  const sendNow = (m: QueuedMessage) => {
    // Mid-dialog, the text would go into the agent's question: ask first.
    if (waiting && confirmId !== m.id) return setConfirmId(m.id);
    setConfirmId(null);
    void window.yggdrasil.queue.sendNow(paneId, m.id);
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void window.yggdrasil.terminals.submit(paneId, text);
  };

  const source = (m: QueuedMessage) =>
    m.sourceLabel ? `${t(SOURCE_KEY[m.source.kind])} · ${m.sourceLabel}` : t(SOURCE_KEY[m.source.kind]);

  return (
    <div className="queue-chip-wrap" ref={ref}>
      <button
        type="button"
        className={`queue-chip${queue.paused ? " paused" : ""}`}
        aria-expanded={open}
        title={t("queue.chipTitle")}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="queue-chip-n">{count}</span>
        {queue.paused ? t("queue.paused") : t("queue.queued")}
      </button>

      {open &&
        createPortal(
        <div className="queue-pop" ref={popRef} style={pos} role="dialog" aria-label={t("queue.listTitle")}>
          <div className="queue-pop-head">
            <span>{queue.paused ? t("queue.headPaused") : t("queue.headNext")}</span>
            <span>{count}</span>
          </div>
          {queue.items.map((m, i) => {
            const ago = agoParts(m.createdAt, Date.now());
            return (
              <div key={m.id} className={`queue-item${i === 0 && !queue.paused ? " next" : ""}`}>
                <span className="queue-item-ord">{i + 1}</span>
                <span className="queue-item-src">
                  <span className={`queue-tag queue-tag--${m.source.kind}`}>{source(m)}</span>
                  {t(ago.key, { n: ago.n })}
                </span>
                {editing?.id === m.id ? (
                  <textarea
                    className="queue-edit"
                    autoFocus
                    value={editing.text}
                    aria-label={t("queue.edit")}
                    onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void window.yggdrasil.queue.edit(paneId, m.id, editing.text);
                        setEditing(null);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditing(null);
                      }
                    }}
                  />
                ) : (
                  <span className="queue-item-text">{m.text}</span>
                )}
                {confirmId === m.id ? (
                  <span className="queue-confirm">
                    {t("queue.confirmWaiting", { question: attention?.message ?? t("attn.waitingFallback") })}
                    <span className="queue-acts">
                      <button type="button" className="queue-act" onClick={() => setConfirmId(null)}>
                        {t("review.cancel")}
                      </button>
                      <button type="button" className="queue-act strong" onClick={() => sendNow(m)}>
                        {t("queue.sendAnyway")}
                      </button>
                    </span>
                  </span>
                ) : (
                  <span className="queue-acts">
                    <button type="button" className="queue-act strong" onClick={() => sendNow(m)}>
                      {t("queue.sendNow")}
                    </button>
                    <button type="button" className="queue-act" onClick={() => setEditing({ id: m.id, text: m.text })}>
                      {t("queue.edit")}
                    </button>
                    {i > 0 && (
                      <button type="button" className="queue-act" aria-label={t("queue.up")} onClick={() => void window.yggdrasil.queue.move(paneId, m.id, -1)}>
                        ↑
                      </button>
                    )}
                    {i < count - 1 && (
                      <button type="button" className="queue-act" aria-label={t("queue.down")} onClick={() => void window.yggdrasil.queue.move(paneId, m.id, 1)}>
                        ↓
                      </button>
                    )}
                    <button type="button" className="queue-act" onClick={() => void window.yggdrasil.queue.remove(paneId, m.id)}>
                      {t("queue.delete")}
                    </button>
                  </span>
                )}
              </div>
            );
          })}
          <div className="queue-add">
            <input
              className="queue-add-input"
              value={draft}
              placeholder={t("queue.addPlaceholder")}
              aria-label={t("queue.addPlaceholder")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className="queue-act strong" disabled={!draft.trim()} onClick={add}>
              {t("queue.add")}
            </button>
          </div>
          <div className="queue-foot">
            <button type="button" className="queue-act" onClick={() => void window.yggdrasil.queue.pause(paneId, !queue.paused)}>
              {queue.paused ? t("queue.resume") : t("queue.pause")}
            </button>
            <button type="button" className="queue-act" disabled={count === 0} onClick={() => void window.yggdrasil.queue.clear(paneId)}>
              {t("queue.clear")}
            </button>
          </div>
        </div>,
          document.body,
        )}
    </div>
  );
}
