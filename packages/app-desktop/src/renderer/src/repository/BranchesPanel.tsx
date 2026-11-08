import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, MagnifyingGlassIcon, PlusIcon } from "@heroicons/react/20/solid";
import { BranchContextMenu } from "./BranchContextMenu.js";
import type { BranchInfo, RemoteInfo, StashInfo } from "./types.js";
import { useI18n } from "../i18n/index.js";

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
  const { t } = useI18n();
  const [newName, setNewName] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; branch: BranchInfo } | null>(null);
  const openMenu = (e: React.MouseEvent, branch: BranchInfo) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, branch });
  };
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState({ local: true, remote: true, stashes: true });
  const toggle = (key: keyof typeof open) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const q = filter.trim().toLowerCase();
  const matches = (b: BranchInfo) => !q || b.name.toLowerCase().includes(q);
  const allLocal = p.branches.filter((b) => !b.remote);
  const allRemote = p.branches.filter((b) => b.remote);
  const local = allLocal.filter(matches);
  const remote = allRemote.filter(matches);

  const sectionHeader = (key: keyof typeof open, label: string, count: number, extra?: React.ReactNode) => (
    <div className="repo-section-head">
      <button type="button" className="repo-section-toggle" onClick={() => toggle(key)} aria-expanded={open[key]}>
        {open[key] ? <ChevronDownIcon className="hero-icon" /> : <ChevronRightIcon className="hero-icon" />}
        {label}
        <span className="repo-count">{count}</span>
      </button>
      {extra}
    </div>
  );

  return (
    <div className="repo-rail">
      <label className="repo-search">
        <MagnifyingGlassIcon className="hero-icon" />
        <input
          className="repo-input"
          placeholder={t("repo.branches.filter")}
          aria-label={t("repo.branches.filter")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>

      <div className="repo-rail-scroll">
        {sectionHeader("local", t("repo.branches.local"), allLocal.length)}
        {open.local && (
          <ul className="repo-list">
            {local.map((b) => (
              <li key={b.name} className={`repo-branch${b.current ? " current" : ""}`} onContextMenu={(e) => openMenu(e, b)}>
                <button
                  type="button"
                  className="repo-branch-main"
                  disabled={p.disabled || b.current}
                  title={b.current ? t("repo.branches.currentBranch") : t("repo.branches.switchTo", { branch: b.name })}
                  onClick={() => p.onCheckout(b.name, false)}
                >
                  <span className={`repo-branch-dot${b.current ? " on" : ""}`} />
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
                    <button type="button" className="repo-icon-btn" disabled={p.disabled} title={t("repo.branches.mergeIntoCurrent", { branch: b.name })} onClick={() => p.onMerge(b.name)}>
                      ⤵
                    </button>
                    <button type="button" className="repo-icon-btn danger" disabled={p.disabled} title={t("repo.branches.deleteBranch")} onClick={() => p.onDelete(b.name)}>
                      ✕
                    </button>
                  </span>
                )}
              </li>
            ))}
            {allLocal.length === 0 && <li className="repo-muted">{t("repo.branches.noBranches")}</li>}
            {allLocal.length > 0 && local.length === 0 && <li className="repo-muted">{t("repo.branches.noMatches")}</li>}
          </ul>
        )}

        {allRemote.length > 0 && (
          <>
            {sectionHeader("remote", p.remotes[0] ? t("repo.branches.remoteNamed", { name: p.remotes[0].name }) : t("repo.branches.remote"), allRemote.length)}
            {open.remote && (
              <ul className="repo-list">
                {remote.map((b) => (
                  <li key={b.name} className="repo-branch" onContextMenu={(e) => openMenu(e, b)}>
                    <button
                      type="button"
                      className="repo-branch-main"
                      disabled={p.disabled}
                      title={t("repo.branches.trackAndSwitch")}
                      onClick={() => p.onCheckout(b.name, true)}
                    >
                      <span className="repo-branch-dot remote" />
                      <span className="repo-branch-name">{b.name}</span>
                    </button>
                    <span className="repo-row-actions">
                      <button type="button" className="repo-icon-btn" disabled={p.disabled} title={t("repo.branches.mergeIntoCurrent", { branch: b.name })} onClick={() => p.onMerge(b.name)}>
                        ⤵
                      </button>
                    </span>
                  </li>
                ))}
                {remote.length === 0 && <li className="repo-muted">{t("repo.branches.noMatches")}</li>}
              </ul>
            )}
          </>
        )}

        {sectionHeader(
          "stashes",
          t("repo.branches.stashes"),
          p.stashes.length,
          <button type="button" className="repo-btn small" disabled={p.disabled} onClick={p.onStashSave} title={t("repo.branches.stashSaveTip")}>
            {t("repo.branches.stashSave")}
          </button>,
        )}
        {open.stashes && (
          <ul className="repo-list">
            {p.stashes.map((s) => (
              <li key={s.index} className="repo-branch">
                <span className="repo-branch-main static" title={s.subject}>
                  <span className="repo-stash-text">
                    <span className="repo-branch-name">{`stash@{${s.index}}`}</span>
                    <span className="repo-stash-sub">{s.subject}</span>
                  </span>
                </span>
                <span className="repo-row-actions">
                  <button type="button" className="repo-icon-btn" disabled={p.disabled} title={t("repo.branches.stashPop")} onClick={() => p.onStashPop(s.index)}>
                    ⤴
                  </button>
                  <button type="button" className="repo-icon-btn" disabled={p.disabled} title={t("repo.branches.stashApply")} onClick={() => p.onStashApply(s.index)}>
                    ⎘
                  </button>
                  <button type="button" className="repo-icon-btn danger" disabled={p.disabled} title={t("repo.branches.stashDrop")} onClick={() => p.onStashDrop(s.index)}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
            {p.stashes.length === 0 && <li className="repo-muted">{t("repo.branches.noStashes")}</li>}
          </ul>
        )}
      </div>

      <div className="repo-rail-footer">
        {creating ? (
          <form
            className="repo-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (!name) return;
              p.onCreate(name);
              setNewName("");
              setCreating(false);
            }}
          >
            <input
              className="repo-input"
              placeholder={t("repo.branches.namePlaceholder")}
              aria-label={t("repo.branches.newNameLabel")}
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
              disabled={p.disabled}
            />
            <button type="submit" className="repo-btn primary" disabled={p.disabled || !newName.trim()}>
              {t("repo.branches.create")}
            </button>
          </form>
        ) : (
          <button type="button" className="repo-btn wide" disabled={p.disabled} onClick={() => setCreating(true)}>
            <PlusIcon className="hero-icon" />
            {t("repo.branches.new")}
          </button>
        )}
      </div>
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
