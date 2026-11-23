import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/index.js";
import type { CodeComment } from "../types.js";

/** Reports its content height so the view zone under the line can make room for it. */
export function Measured({ onHeight, children }: { onHeight: (px: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onHeight);
  latest.current = onHeight;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => latest.current(el.getBoundingClientRect().height + 10);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="review-zone-inner">
      {children}
    </div>
  );
}

export function linesLabel(t: ReturnType<typeof useI18n>["t"], start: number, end: number): string {
  return start === end ? t("review.line", { n: start }) : t("review.lines", { a: start, b: end });
}

/** The textarea for a new comment or for editing one. Enter saves, Shift+Enter is a new line, Esc cancels. */
export function ReviewComposer({
  initial = "",
  label,
  onSave,
  onCancel,
}: {
  initial?: string;
  label: string;
  onSave: (text: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(text.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="review-card review-composer">
      <textarea
        ref={ref}
        className="review-textarea"
        value={text}
        placeholder={t("review.placeholder")}
        aria-label={t("review.placeholder")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="review-composer-row">
        <span>{label}</span>
        <span className="review-spacer" />
        <span className="review-hint">{t("review.hint")}</span>
        <button type="button" className="review-btn" onClick={onCancel}>
          {t("review.cancel")}
        </button>
        <button type="button" className="review-btn primary" disabled={!text.trim() || busy} onClick={() => void save()}>
          {initial ? t("review.save") : t("review.comment")}
        </button>
      </div>
    </div>
  );
}

/** A saved comment under its lines: state, lines, text and what can be done with it. */
export function ReviewCard({
  comment,
  location,
  onEdit,
  onDelete,
  onStatus,
}: {
  comment: CodeComment;
  /** Where its lines are now; null when the code it was made on is gone. */
  location: { startLine: number; endLine: number } | null;
  onEdit: (text: string) => Promise<void>;
  onDelete: () => void;
  onStatus: (status: CodeComment["status"]) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const stale = location === null && comment.status !== "done";
  const where = location ?? { startLine: comment.startLine, endLine: comment.endLine };
  const label = linesLabel(t, where.startLine, where.endLine);

  if (editing) {
    return (
      <ReviewComposer
        initial={comment.comment}
        label={label}
        onSave={async (text) => {
          await onEdit(text);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const chip = stale ? (
    <span className="review-chip stale">{t("review.status.stale")}</span>
  ) : comment.status === "sent" ? (
    <span className="review-chip sent">{comment.sentTo ? t("review.status.sentTo", { to: comment.sentTo }) : t("review.status.sent")}</span>
  ) : comment.status === "done" ? (
    <span className="review-chip done">{t("review.status.done")}</span>
  ) : (
    <span className="review-chip idle">{t("review.status.idle")}</span>
  );

  return (
    <div className={`review-card ${stale ? "stale" : comment.status}`}>
      <div className="review-card-meta">
        {chip}
        <span>{stale ? t("review.staleNote", { lines: label }) : label}</span>
        <span className="review-spacer" />
        {comment.status === "done" ? (
          <button type="button" className="review-link" onClick={() => onStatus("idle")}>
            {t("review.reopen")}
          </button>
        ) : (
          <>
            {!stale && (
              <button type="button" className="review-link" onClick={() => setEditing(true)}>
                {t("review.edit")}
              </button>
            )}
            <button type="button" className="review-link" onClick={() => onStatus("done")}>
              {t("review.resolve")}
            </button>
          </>
        )}
        <button type="button" className="review-link" onClick={onDelete}>
          {t("review.delete")}
        </button>
      </div>
      <div className="review-card-text">{comment.comment}</div>
      {stale && comment.snippet && <pre className="review-card-snippet">{comment.snippet.split("\n").slice(0, 4).join("\n")}</pre>}
    </div>
  );
}
