import { useState } from "react";
import { BranchContextMenu } from "./BranchContextMenu.js";
import type { BranchInfo, RemoteInfo, StashInfo } from "./types.js";

type Props = {
  branches: BranchInfo[];
  stashes: StashInfo[];
  remotes: RemoteInfo[];
  currentBranch?: string;
  disabled: boolean;
  onCheckout: (branch: string, remote: boolean) => void;
  onCreate: (name: string) => void;
  onDelete: (branch: string) => void;
  onMerge: (branch: string) => void;
  onCreateFrom: (newName: string, from: string) => void;
  onPush: (branch: string) => void;
  onPull: () => void;
  onStashSave: () => void;
  onStashPop: (index: number) => void;
  onStashApply: (index: number) => void;
  onStashDrop: (index: number) => void;
};

export function BranchesPanel(p: Props) {
  const [newName, setNewName] = useState("");
  const [showRemotes, setShowRemotes] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; branch: BranchInfo } | null>(null);
  const openMenu = (e: React.MouseEvent, branch: BranchInfo) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, branch });
  };
  const local = p.branches.filter((b) => !b.remote);
  const remote = p.branches.filter((b) => b.remote);

  return (
    <div className="repo-rail">
      <div className="repo-rail-title">Ramas</div>
      <form
        className="repo-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) return;
          p.onCreate(name);
          setNewName("");
        }}
      >
        <input
          className="repo-input"
          placeholder="Nueva rama…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={p.disabled}
        />
        <button type="submit" className="repo-btn" disabled={p.disabled || !newName.trim()}>
          Crear
        </button>
      </form>
      <ul className="repo-list">
        {local.map((b) => (
          <li key={b.name} className={`repo-branch${b.current ? " current" : ""}`} onContextMenu={(e) => openMenu(e, b)}>
            <button
              type="button"
              className="repo-branch-main"
              disabled={p.disabled || b.current}
              title={b.current ? "Rama actual" : `Cambiar a ${b.name}`}
              onClick={() => p.onCheckout(b.name, false)}
            >
              <span className="repo-branch-dot">{b.current ? "●" : "○"}</span>
              <span className="repo-branch-name">{b.name}</span>
              {(b.ahead > 0 || b.behind > 0) && (
                <span className="repo-ahead-behind">
                  {b.ahead > 0 ? `↑${b.ahead}` : ""}
                  {b.behind > 0 ? ` ↓${b.behind}` : ""}
                </span>
              )}
            </button>
            {!b.current && (
              <span className="repo-row-actions">
                <button type="button" className="repo-icon-btn" disabled={p.disabled} title={`Merge ${b.name} en la rama actual`} onClick={() => p.onMerge(b.name)}>
                  ⤵
                </button>
                <button type="button" className="repo-icon-btn danger" disabled={p.disabled} title="Borrar rama" onClick={() => p.onDelete(b.name)}>
                  ✕
                </button>
              </span>
            )}
          </li>
        ))}
        {local.length === 0 && <li className="repo-muted">Sin ramas (repositorio sin commits)</li>}
      </ul>

      {remote.length > 0 && (
        <>
          <button type="button" className="repo-section-toggle" onClick={() => setShowRemotes((v) => !v)}>
            {showRemotes ? "▾" : "▸"} Remotas ({remote.length})
          </button>
          {showRemotes && (
            <ul className="repo-list">
              {remote.map((b) => (
                <li key={b.name} className="repo-branch" onContextMenu={(e) => openMenu(e, b)}>
                  <button
                    type="button"
                    className="repo-branch-main"
                    disabled={p.disabled}
                    title="Crear rama local que siga a esta y cambiar"
                    onClick={() => p.onCheckout(b.name, true)}
                  >
                    <span className="repo-branch-dot">☁</span>
                    <span className="repo-branch-name">{b.name}</span>
                  </button>
                  <span className="repo-row-actions">
                    <button type="button" className="repo-icon-btn" disabled={p.disabled} title={`Merge ${b.name} en la rama actual`} onClick={() => p.onMerge(b.name)}>
                      ⤵
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="repo-rail-title">
        Stashes
        <button type="button" className="repo-btn small" disabled={p.disabled} onClick={p.onStashSave}>
          + Guardar
        </button>
      </div>
      <ul className="repo-list">
        {p.stashes.map((s) => (
          <li key={s.index} className="repo-branch">
            <span className="repo-branch-main static" title={s.subject}>
              <span className="repo-branch-name">{s.subject}</span>
            </span>
            <span className="repo-row-actions">
              <button type="button" className="repo-icon-btn" disabled={p.disabled} title="Pop (aplicar y borrar)" onClick={() => p.onStashPop(s.index)}>
                ⤴
              </button>
              <button type="button" className="repo-icon-btn" disabled={p.disabled} title="Aplicar (mantener)" onClick={() => p.onStashApply(s.index)}>
                ⎘
              </button>
              <button type="button" className="repo-icon-btn danger" disabled={p.disabled} title="Borrar stash" onClick={() => p.onStashDrop(s.index)}>
                ✕
              </button>
            </span>
          </li>
        ))}
        {p.stashes.length === 0 && <li className="repo-muted">Sin stashes</li>}
      </ul>
      {menu && (
        <BranchContextMenu
          x={menu.x}
          y={menu.y}
          branch={menu.branch}
          currentBranch={p.currentBranch}
          remotes={p.remotes}
          disabled={p.disabled}
          onClose={() => setMenu(null)}
          onCheckout={() => p.onCheckout(menu.branch.name, menu.branch.remote)}
          onCreateFrom={(name) => p.onCreateFrom(name, menu.branch.name)}
          onMerge={() => p.onMerge(menu.branch.name)}
          onPush={() => p.onPush(menu.branch.name)}
          onPull={p.onPull}
          onDelete={() => p.onDelete(menu.branch.name)}
        />
      )}
    </div>
  );
}
