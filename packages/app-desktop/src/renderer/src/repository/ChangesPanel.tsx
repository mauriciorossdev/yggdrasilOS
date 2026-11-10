import { useState } from "react";
import { ArrowUturnLeftIcon, MinusIcon, PlusIcon } from "@heroicons/react/20/solid";
import { splitPath } from "./format.js";
import { ChangeList, TREE_INDENT, type ChangeRowContext } from "./ChangeList.js";
import type { ChangeViewMode } from "./changeTree.js";
import type { DiffSelection, GitChange, RepoStatus } from "./types.js";

const changePath = (c: GitChange) => c.path;
import { useI18n, type MessageKey } from "../i18n/index.js";

const LETTER_TITLE: Record<string, MessageKey> = {
  M: "repo.changes.letter.M",
  A: "repo.changes.letter.A",
  D: "repo.changes.letter.D",
  R: "repo.changes.letter.R",
  C: "repo.changes.letter.C",
  T: "repo.changes.letter.T",
  U: "repo.changes.letter.U",
  "?": "repo.changes.letter.untracked",
};

const SUMMARY_SOFT_LIMIT = 72;

type Props = {
  status: RepoStatus;
  branch?: string;
  selected: DiffSelection | null;
  disabled: boolean;
  viewMode: ChangeViewMode;
  onSelect: (sel: DiffSelection) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscard: (change: GitChange) => void;
  onCommit: (message: string, amend: boolean) => Promise<boolean>;
  onAbortMerge: () => void;
};

function Row({
  change,
  letter,
  active,
  disabled,
  onClick,
  actions,
  ctx,
}: {
  change: GitChange;
  letter: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  actions: React.ReactNode;
  ctx: ChangeRowContext;
}) {
  const { t } = useI18n();
  const split = splitPath(change.path);
  const dir = ctx.tree ? "" : split.dir;
  const file = split.file;
  return (
    <li className={`repo-change${active ? " active" : ""}`}>
      <button
        type="button"
        className={`repo-change-main${ctx.tree ? " tree" : ""}`}
        style={ctx.tree ? { paddingLeft: ctx.depth * TREE_INDENT + 8 } : undefined}
        onClick={onClick}
        title={change.origPath ? `${change.origPath} → ${change.path}` : change.path}
      >
        <span className={`repo-letter l-${letter === "?" ? "u" : letter}`} title={LETTER_TITLE[letter] ? t(LETTER_TITLE[letter]) : letter}>
          {letter === "?" ? "U" : letter}
        </span>
        <span className="repo-change-name">
          <span className="repo-change-file">{file}</span>
          {dir && <span className="repo-change-dir">{dir}</span>}
        </span>
      </button>
      <span className={`repo-row-actions${disabled ? " disabled" : ""}`}>{actions}</span>
    </li>
  );
}

export function ChangesPanel(p: Props) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [description, setDescription] = useState("");
  const [amend, setAmend] = useState(false);

  const conflicts = p.status.changes.filter((c) => c.kind === "unmerged");
  const staged = p.status.changes.filter((c) => c.kind !== "unmerged" && c.kind !== "untracked" && c.index !== ".");
  const unstaged = p.status.changes.filter(
    (c) => c.kind === "untracked" || (c.kind !== "unmerged" && c.worktree !== "."),
  );
  const fullMessage = description.trim() ? `${message.trim()}\n\n${description.trim()}` : message.trim();
  const canCommit = (staged.length > 0 || amend) && (message.trim().length > 0 || amend) && conflicts.length === 0;

  const isActive = (path: string, mode: "staged" | "unstaged") =>
    p.selected?.kind === "change" && p.selected.path === path && p.selected.mode === mode;

  return (
    <div className="repo-changes">
      <div className="repo-changes-scroll">
      {p.status.merging && (
        <div className="repo-banner warn">
          {t("repo.changes.mergeInProgress")}
          {conflicts.length > 0 ? t("repo.changes.conflictFiles", { count: conflicts.length }) : ""}. {t("repo.changes.mergeHelp")}
          <button type="button" className="repo-btn small" disabled={p.disabled} onClick={p.onAbortMerge}>
            {t("repo.changes.abortMerge")}
          </button>
        </div>
      )}

      {conflicts.length > 0 && (
        <section>
          <div className="repo-section-title">
            <span>{t("repo.changes.conflicts")}</span>
            <span className="repo-count danger">{conflicts.length}</span>
          </div>
          <ul className="repo-list">
            <ChangeList items={conflicts} getPath={changePath} mode={p.viewMode} renderRow={(c, ctx) => (
              <Row
                key={c.path}
                ctx={ctx}
                change={c}
                letter="U"
                active={isActive(c.path, "unstaged")}
                disabled={p.disabled}
                onClick={() => p.onSelect({ kind: "change", path: c.path, mode: "unstaged" })}
                actions={
                  <button type="button" className="repo-icon-btn" title={t("repo.changes.markResolved")} disabled={p.disabled} onClick={() => p.onStage([c.path])}>
                    <PlusIcon className="hero-icon" />
                  </button>
                }
              />
            )} />
          </ul>
        </section>
      )}

      <section>
        <div className="repo-section-title">
          <span>{t("repo.changes.staged")}</span>
          <span className="repo-count">{staged.length}</span>
          {staged.length > 0 && (
            <button type="button" className="repo-btn small push-right" disabled={p.disabled} onClick={p.onUnstageAll}>
              {t("repo.changes.unstageAll")}
            </button>
          )}
        </div>
        <ul className="repo-list">
          <ChangeList items={staged} getPath={changePath} mode={p.viewMode} renderRow={(c, ctx) => (
            <Row
              key={`s:${c.path}`}
              ctx={ctx}
              change={c}
              letter={c.index}
              active={isActive(c.path, "staged")}
              disabled={p.disabled}
              onClick={() => p.onSelect({ kind: "change", path: c.path, mode: "staged" })}
              actions={
                <button type="button" className="repo-icon-btn" title={t("repo.changes.unstage")} disabled={p.disabled} onClick={() => p.onUnstage([c.path])}>
                  <MinusIcon className="hero-icon" />
                </button>
              }
            />
          )} />
          {staged.length === 0 && <li className="repo-muted">{t("repo.changes.nothingStaged")}</li>}
        </ul>
      </section>

      <section>
        <div className="repo-section-title">
          <span>{t("repo.changes.changes")}</span>
          <span className="repo-count">{unstaged.length}</span>
          {unstaged.length > 0 && (
            <button type="button" className="repo-btn small push-right" disabled={p.disabled} onClick={p.onStageAll}>
              {t("repo.changes.stageAll")}
            </button>
          )}
        </div>
        <ul className="repo-list">
          <ChangeList items={unstaged} getPath={changePath} mode={p.viewMode} renderRow={(c, ctx) => (
            <Row
              key={`u:${c.path}`}
              ctx={ctx}
              change={c}
              letter={c.worktree}
              active={isActive(c.path, "unstaged")}
              disabled={p.disabled}
              onClick={() => p.onSelect({ kind: "change", path: c.path, mode: "unstaged" })}
              actions={
                <>
                  <button type="button" className="repo-icon-btn danger" title={t("repo.changes.discard")} disabled={p.disabled} onClick={() => p.onDiscard(c)}>
                    <ArrowUturnLeftIcon className="hero-icon" />
                  </button>
                  <button type="button" className="repo-icon-btn" title="Stage" disabled={p.disabled} onClick={() => p.onStage([c.path])}>
                    <PlusIcon className="hero-icon" />
                  </button>
                </>
              }
            />
          )} />
          {unstaged.length === 0 && <li className="repo-muted">{t("repo.changes.clean")}</li>}
        </ul>
      </section>

      </div>

      <form
        className="repo-commit-box"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canCommit) return;
          if (await p.onCommit(fullMessage, amend)) {
            setMessage("");
            setDescription("");
            setAmend(false);
          }
        }}
      >
        <input
          className="repo-input"
          placeholder={amend ? t("repo.changes.summaryAmend") : t("repo.changes.messagePlaceholder")}
          aria-label={t("repo.changes.messagePlaceholder")}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={p.disabled}
        />
        <textarea
          className="repo-input mono"
          rows={3}
          placeholder={t("repo.changes.descPlaceholder")}
          aria-label={t("repo.changes.descLabel")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={p.disabled}
        />
        <div className="repo-commit-actions">
          <label className="repo-check">
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} /> {t("repo.changes.amendLast")}
          </label>
          <span className={`repo-counter${message.length > SUMMARY_SOFT_LIMIT ? " over" : ""}`}>
            {message.length}/{SUMMARY_SOFT_LIMIT}
          </span>
        </div>
        <button type="submit" className="repo-btn primary wide tall" disabled={p.disabled || !canCommit}>
          {amend ? t("repo.changes.amendCommit") : t(staged.length === 1 ? "repo.changes.commitOne" : "repo.changes.commitMany", { count: staged.length })}
          {p.branch && !amend && <span className="repo-commit-branch">{t("repo.changes.onBranch", { branch: p.branch })}</span>}
        </button>
      </form>
    </div>
  );
}
