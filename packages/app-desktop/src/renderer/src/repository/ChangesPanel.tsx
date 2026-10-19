import { useState } from "react";
import type { DiffSelection, GitChange, RepoStatus } from "./types.js";

const LETTER_TITLE: Record<string, string> = {
  M: "Modificado",
  A: "Añadido",
  D: "Borrado",
  R: "Renombrado",
  C: "Copiado",
  T: "Tipo cambiado",
  U: "Conflicto",
  "?": "Sin rastrear",
};

type Props = {
  status: RepoStatus;
  selected: DiffSelection | null;
  disabled: boolean;
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
}: {
  change: GitChange;
  letter: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  actions: React.ReactNode;
}) {
  const slash = change.path.lastIndexOf("/");
  const dir = slash >= 0 ? change.path.slice(0, slash + 1) : "";
  const file = slash >= 0 ? change.path.slice(slash + 1) : change.path;
  return (
    <li className={`repo-change${active ? " active" : ""}`}>
      <button type="button" className="repo-change-main" onClick={onClick} title={change.origPath ? `${change.origPath} → ${change.path}` : change.path}>
        <span className={`repo-letter l-${letter === "?" ? "u" : letter}`} title={LETTER_TITLE[letter] ?? letter}>
          {letter}
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
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);

  const conflicts = p.status.changes.filter((c) => c.kind === "unmerged");
  const staged = p.status.changes.filter((c) => c.kind !== "unmerged" && c.kind !== "untracked" && c.index !== ".");
  const unstaged = p.status.changes.filter(
    (c) => c.kind === "untracked" || (c.kind !== "unmerged" && c.worktree !== "."),
  );
  const canCommit = (staged.length > 0 || amend) && (message.trim().length > 0 || amend) && conflicts.length === 0;

  const isActive = (path: string, mode: "staged" | "unstaged") =>
    p.selected?.kind === "change" && p.selected.path === path && p.selected.mode === mode;

  return (
    <div className="repo-changes">
      {p.status.merging && (
        <div className="repo-banner warn">
          Merge en curso{conflicts.length > 0 ? ` — ${conflicts.length} archivo(s) con conflicto` : ""}.
          Resolvé los conflictos en el editor, hacé stage y commit.
          <button type="button" className="repo-btn small" disabled={p.disabled} onClick={p.onAbortMerge}>
            Abortar merge
          </button>
        </div>
      )}

      {conflicts.length > 0 && (
        <section>
          <div className="repo-section-title">Conflictos ({conflicts.length})</div>
          <ul className="repo-list">
            {conflicts.map((c) => (
              <Row
                key={c.path}
                change={c}
                letter="U"
                active={isActive(c.path, "unstaged")}
                disabled={p.disabled}
                onClick={() => p.onSelect({ kind: "change", path: c.path, mode: "unstaged" })}
                actions={
                  <button type="button" className="repo-icon-btn" title="Marcar como resuelto (stage)" disabled={p.disabled} onClick={() => p.onStage([c.path])}>
                    ＋
                  </button>
                }
              />
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="repo-section-title">
          Staged ({staged.length})
          {staged.length > 0 && (
            <button type="button" className="repo-btn small" disabled={p.disabled} onClick={p.onUnstageAll}>
              Quitar todo
            </button>
          )}
        </div>
        <ul className="repo-list">
          {staged.map((c) => (
            <Row
              key={`s:${c.path}`}
              change={c}
              letter={c.index}
              active={isActive(c.path, "staged")}
              disabled={p.disabled}
              onClick={() => p.onSelect({ kind: "change", path: c.path, mode: "staged" })}
              actions={
                <button type="button" className="repo-icon-btn" title="Quitar de staged" disabled={p.disabled} onClick={() => p.onUnstage([c.path])}>
                  −
                </button>
              }
            />
          ))}
          {staged.length === 0 && <li className="repo-muted">Nada en staged</li>}
        </ul>
      </section>

      <section>
        <div className="repo-section-title">
          Cambios ({unstaged.length})
          {unstaged.length > 0 && (
            <button type="button" className="repo-btn small" disabled={p.disabled} onClick={p.onStageAll}>
              Stage todo
            </button>
          )}
        </div>
        <ul className="repo-list">
          {unstaged.map((c) => (
            <Row
              key={`u:${c.path}`}
              change={c}
              letter={c.worktree}
              active={isActive(c.path, "unstaged")}
              disabled={p.disabled}
              onClick={() => p.onSelect({ kind: "change", path: c.path, mode: "unstaged" })}
              actions={
                <>
                  <button type="button" className="repo-icon-btn danger" title="Descartar cambios" disabled={p.disabled} onClick={() => p.onDiscard(c)}>
                    ↺
                  </button>
                  <button type="button" className="repo-icon-btn" title="Stage" disabled={p.disabled} onClick={() => p.onStage([c.path])}>
                    ＋
                  </button>
                </>
              }
            />
          ))}
          {unstaged.length === 0 && <li className="repo-muted">Working tree limpio</li>}
        </ul>
      </section>

      <form
        className="repo-commit-box"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canCommit) return;
          if (await p.onCommit(message, amend)) {
            setMessage("");
            setAmend(false);
          }
        }}
      >
        <textarea
          className="repo-input"
          rows={3}
          placeholder={amend ? "Mensaje (vacío = conservar el actual)" : "Mensaje del commit"}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={p.disabled}
        />
        <div className="repo-commit-actions">
          <label className="repo-check">
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} /> Amend
          </label>
          <button type="submit" className="repo-btn primary" disabled={p.disabled || !canCommit}>
            {amend ? "Amend commit" : "Commit"}
          </button>
        </div>
      </form>
    </div>
  );
}
