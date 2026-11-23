import { useCallback, useMemo, useRef, useState } from "react";
import { useDismiss } from "../ui/index.js";
import { useI18n } from "../i18n/index.js";
import { useOnboarding } from "../onboarding/store.js";
import { terminalLaunchClis } from "../onboarding/harnessFilter.js";
import { useAttention } from "../terminal/attentionStore.js";
import type { CodeComment, CodeCommentTarget, CodeCommentTargets } from "../types.js";
import { refreshCodeComments, requestRevealComment, setHideDoneComments, useCodeComments, useHideDoneComments } from "./codeCommentsStore.js";
import { suggestPane } from "./suggestTarget.js";

type Props = {
  /** Absolute repo/worktree root whose comments this bar gathers. */
  root: string;
  /** Short name of that repo/worktree, for "New agent in …". */
  name: string;
  /** Opens the file of a comment from the list (another file than the one on screen); then it scrolls to it. */
  onOpen?: (comment: CodeComment) => void;
};

type ListTab = "idle" | "sent" | "done";

/**
 * The review bar under a diff or a file: what's pending in this repo or
 * worktree, the list of every comment, and "Send to" an agent: the pane
 * working there first, then the others, then a new agent started in that
 * folder. Hidden while the repo has no comments.
 */
export function ReviewBar({ root, name, onOpen }: Props) {
  const { t } = useI18n();
  const comments = useCodeComments(root);
  const hideDone = useHideDoneComments();
  const attention = useAttention();
  const { settings: onboardingSettings } = useOnboarding();
  const [menu, setMenu] = useState<"send" | "list" | null>(null);
  const [tab, setTab] = useState<ListTab>("idle");
  const [targets, setTargets] = useState<CodeCommentTargets | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setMenu(null), []);
  useDismiss(ref, close, menu !== null);

  const byStatus = useMemo(() => {
    const out: Record<ListTab, CodeComment[]> = { idle: [], sent: [], done: [] };
    comments.forEach((c) => out[c.status].push(c));
    return out;
  }, [comments]);
  const pendingFiles = new Set(byStatus.idle.map((c) => c.path)).size;

  if (comments.length === 0) return null;

  const openSend = async () => {
    if (menu === "send") return setMenu(null);
    setMenu("send");
    setNotice(null);
    const clis = terminalLaunchClis(onboardingSettings).map(({ id, label, command }) => ({ id, label, command }));
    await window.yggdrasil.browserTab.comments.setProviders(clis);
    setTargets(await window.yggdrasil.codeComments.targets());
  };

  const send = async (target: CodeCommentTarget, label: string) => {
    setMenu(null);
    setSending(true);
    const res = await window.yggdrasil.codeComments.send({ root, target });
    setSending(false);
    setNotice(
      !res.ok
        ? { ok: false, text: t("review.bar.sendFailed", { error: res.error ?? "?" }) }
        : res.queued
          ? { ok: true, text: t("review.bar.queuedOk", { name: label, position: res.position ?? "?" }) }
          : { ok: true, text: t("review.bar.sentOk", { name: label }) },
    );
    void refreshCodeComments(root);
  };

  const suggested = targets ? suggestPane(root, targets.panes, attention) : undefined;
  const others = targets ? targets.panes.filter((p) => p.id !== suggested?.id) : [];
  const paneOption = (p: CodeCommentTargets["panes"][number], highlight: boolean) => {
    const a = attention[p.id];
    return (
      <button
        key={p.id}
        type="button"
        className={`review-opt${highlight ? " hl" : ""}`}
        onClick={() => void send({ kind: "pane", paneId: p.id, name: p.title }, p.title)}
      >
        <span className={`review-sq${p.command === "claude" ? " claude" : ""}`} aria-hidden />
        <span className="review-opt-body">
          {p.title}
          <small>{[p.command ?? t("review.bar.shell"), p.cwd ? p.cwd.split("/").pop() : null].filter(Boolean).join(" · ")}</small>
        </span>
        {a?.status === "done" && <span className="review-opt-state done">{t("review.bar.stateDone")}</span>}
        {a?.status === "working" && <span className="review-opt-state working">{t("review.bar.stateWorking")}</span>}
        {a?.status === "waiting" && <span className="review-opt-state waiting">{t("review.bar.stateWaiting")}</span>}
      </button>
    );
  };

  const listed = byStatus[tab];

  return (
    <div className="review-bar" ref={ref}>
      <span className="review-bar-count">
        {byStatus.idle.length > 0 && <span className="review-glyph-inline idle" aria-hidden />}
        {byStatus.idle.length === 0
          ? t("review.bar.nonePending")
          : byStatus.idle.length === 1
            ? t("review.bar.pendingOne")
            : t("review.bar.pending", { count: byStatus.idle.length, files: pendingFiles })}
      </span>
      {byStatus.sent.length > 0 && <span className="review-bar-meta">· {t("review.bar.sentCount", { count: byStatus.sent.length })}</span>}
      <button type="button" className="review-link" aria-expanded={menu === "list"} onClick={() => setMenu(menu === "list" ? null : "list")}>
        {t("review.bar.viewAll")}
      </button>
      {notice && <span className={`review-bar-notice${notice.ok ? "" : " error"}`}>{notice.text}</span>}
      <span className="review-spacer" />
      <button
        type="button"
        className="review-btn primary"
        disabled={byStatus.idle.length === 0 || sending}
        aria-expanded={menu === "send"}
        onClick={() => void openSend()}
      >
        {sending ? t("review.bar.sending") : t("review.bar.send")} ▾
      </button>

      {menu === "send" && (
        <div className="review-menu" role="menu">
          {!targets ? (
            <div className="review-menu-empty">{t("review.bar.loading")}</div>
          ) : (
            <>
              {suggested && (
                <>
                  <div className="review-menu-sec">{t("review.bar.suggested")}</div>
                  {paneOption(suggested, true)}
                </>
              )}
              {others.length > 0 && (
                <>
                  <div className="review-menu-sec">{suggested ? t("review.bar.otherPanes") : t("review.bar.panes")}</div>
                  {others.map((p) => paneOption(p, false))}
                </>
              )}
              {targets.providers.length > 0 && (
                <>
                  <div className="review-menu-sec">{t("review.bar.newAgent", { name })}</div>
                  {targets.providers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="review-opt"
                      onClick={() => void send({ kind: "new", command: p.command, label: p.label }, p.label)}
                    >
                      <span className={`review-sq${p.command === "claude" ? " claude" : ""}`} aria-hidden />
                      <span className="review-opt-body">{p.label}</span>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {menu === "list" && (
        <div className="review-menu review-list" role="dialog" aria-label={t("review.bar.listTitle", { name })}>
          <div className="review-tabs">
            {(["idle", "sent", "done"] as const).map((k) => (
              <button key={k} type="button" className={`review-tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>
                {t(`review.bar.tab.${k}`, { count: byStatus[k].length })}
              </button>
            ))}
          </div>
          {listed.length === 0 ? (
            <div className="review-menu-empty">{t("review.bar.empty")}</div>
          ) : (
            listed.map((c) => (
              <button
                key={c.id}
                type="button"
                className="review-item"
                onClick={() => {
                  setMenu(null);
                  onOpen?.(c);
                  requestRevealComment(root, c.path, c.id);
                }}
              >
                <span className="review-item-loc">
                  {c.path.split("/").pop()}:{c.startLine === c.endLine ? c.startLine : `${c.startLine}–${c.endLine}`}
                  {c.side === "original" ? ` · ${t("review.deletedSide")}` : ""}
                </span>
                <span className="review-item-text">{c.comment}</span>
              </button>
            ))
          )}
          <div className="review-list-footer">
            <label className="review-check">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDoneComments(e.target.checked)} />
              {t("review.bar.hideDone")}
            </label>
            <button
              type="button"
              className="review-link"
              disabled={byStatus.done.length === 0}
              onClick={() => void window.yggdrasil.codeComments.clearDone(root).then(() => refreshCodeComments(root))}
            >
              {t("review.bar.clearDone")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
