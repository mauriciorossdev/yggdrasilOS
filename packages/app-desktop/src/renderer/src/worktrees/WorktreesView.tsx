import { useCallback, useEffect, useMemo, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { useI18n, type MessageKey } from "../i18n/index.js";
import { setActiveTab, useActiveTab } from "../ui/mainTabsStore.js";
import { TerminalMirror } from "../terminal/TerminalMirror.js";
import { requestFocusPane, useTerminalPanes, type TerminalPaneSummary } from "../terminal/terminalPanesStore.js";
import { RepoSelector } from "../repository/RepoSelector.js";
import { requestOpenRepo } from "../repository/openRepoRequest.js";
import type { CommitInfo, RepoInfo, RepoStatus, WorktreeInfo } from "../repository/types.js";
import { worktreeDisplayPath, worktreeRepoParam } from "./paths.js";
import { addPidPanes, panesByWorktree } from "./panes.js";
import { NewWorktreeDialog } from "./NewWorktreeDialog.js";
import { ORIGIN_LABEL, worktreeState, type Msg } from "./status.js";
import { closeOptions, isAbandoned } from "./actions.js";
import { DiscardDialog, MergeDialog, PullRequestDialog } from "./CloseDialogs.js";
import { BulkDialog } from "./BulkDialog.js";
import { bulkGroup, type BulkGroup, type BulkItem, type Grouped } from "./bulk.js";
import { useAttention } from "../terminal/attentionStore.js";

const REFRESH_MS = 5000;
const LOG_LIMIT = 30;

type DialogKind = "merge" | "pr" | "discard";
type ReposResult = { workspaceRoot: string; repos: RepoInfo[] };
type WorktreesResult = { base?: string; worktrees: WorktreeInfo[] };

function label(w: WorktreeInfo, t: (key: MessageKey) => string): string {
  if (w.main) return w.branch ?? t("wt.view.mainCheckout");
  const folder = w.path.replace(/\\/g, "/").split("/").pop() ?? w.path;
  return folder;
}

/**
 * "Worktrees" main tab: every git worktree of the project's repo, whoever made
 * it (this app, Claude Code, by hand), with what git says about each, and the ways to close
 * one: merge it, publish it as a pull request, or discard it. Backed by the gateway's git.worktrees.
 */
export function WorktreesView() {
  const { call } = useGateway();
  const { t } = useI18n();
  const visible = useActiveTab() === "worktrees";
  const [root, setRoot] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoInfo[] | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [data, setData] = useState<WorktreesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { panes } = useTerminalPanes();
  const [creating, setCreating] = useState(false);
  // A closing dialog keeps its own copy of the worktree: it may vanish from the list while the dialog shows the outcome.
  const [closing, setClosing] = useState<{ kind: DialogKind; worktree: WorktreeInfo; canCleanup: boolean } | null>(null);
  // Pane behind each live Claude session lock (worktree path → pane id), resolved by pid in main.
  const [pidPane, setPidPane] = useState<Record<string, string>>({});
  // Bulk actions (notes/features/worktree-bulk-actions.md): checked worktree paths, and the batch dialog.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ kind: "merge" | "remove"; items: BulkItem[] } | null>(null);
  const attention = useAttention();

  const loadRepos = useCallback(async () => {
    try {
      const res = await call<ReposResult>("git.repos", {});
      setRoot(res.workspaceRoot);
      setRepos(res.repos);
      setRepo((cur) => (cur && res.repos.some((r) => r.path === cur) ? cur : (res.repos[0]?.path ?? null)));
    } catch (err) {
      setRepos([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [call]);

  const loadWorktrees = useCallback(async () => {
    if (repo === null) return;
    try {
      const res = await call<WorktreesResult>("git.worktrees", { repo });
      setData(res);
      setError(null);
      const found: Record<string, string> = {};
      await Promise.all(
        res.worktrees.map(async (w) => {
          if (!w.claudeSession?.alive) return;
          const id = await window.yggdrasil.terminals.forPid(w.claudeSession.pid);
          if (id) found[w.path] = id;
        }),
      );
      setPidPane(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [call, repo]);

  // Only poll while the tab is showing: all tabs stay mounted (MainTabs).
  useEffect(() => {
    if (!visible) return;
    void loadRepos();
  }, [visible, loadRepos]);

  useEffect(() => {
    if (!visible || repo === null) return;
    void loadWorktrees();
    const timer = window.setInterval(() => void loadWorktrees(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [visible, repo, loadWorktrees]);

  const worktrees = data?.worktrees ?? [];
  const current = useMemo(
    () => worktrees.find((w) => w.path === selected) ?? worktrees.find((w) => !w.main) ?? worktrees[0] ?? null,
    [worktrees, selected],
  );

  const linkedPanes = useMemo(
    () => addPidPanes(panesByWorktree(panes, worktrees.map((w) => w.path)), pidPane, panes),
    [panes, worktrees, pidPane],
  );

  const groups = useMemo(() => {
    const out = new Map<string, Grouped>();
    for (const w of worktrees) {
      const g = bulkGroup(w, data?.base, linkedPanes.get(w.path) ?? [], attention);
      if (g) out.set(w.path, g);
    }
    return out;
  }, [worktrees, data?.base, linkedPanes, attention]);

  // A worktree that left its group (an agent started, it was removed) leaves the selection.
  useEffect(() => {
    setChecked((cur) => {
      const next = new Set([...cur].filter((p) => groups.get(p) && groups.get(p)!.group !== "busy"));
      return next.size === cur.size ? cur : next;
    });
  }, [groups]);

    if (repos === null) return <div className="repo-view"><div className="repo-empty">{t("wt.view.searching")}</div></div>;
  if (repos.length === 0) {
    return (
      <div className="repo-view">
        <div className="repo-empty">
          {t("wt.view.noRepo")}
          {error && <div className="repo-banner error">{error}</div>}
        </div>
      </div>
    );
  }

  const linked = worktrees.filter((w) => !w.main);

  return (
    <div className="repo-view">
      <div className="repo-topbar">
        <RepoSelector repos={repos} selected={repo} onSelect={setRepo} />
        <div className="repo-topbar-spacer" />
        <button type="button" className="repo-btn" onClick={() => void loadWorktrees()}>
          {t("wt.view.refresh")}
        </button>
        <button type="button" className="repo-btn primary" onClick={() => setCreating(true)} disabled={repo === null}>
          {t("wt.view.new")}
        </button>
      </div>
      {creating && repo !== null && (
        <NewWorktreeDialog
          repo={repo}
          onClose={() => setCreating(false)}
          onCreated={(paths) => {
            setSelected(paths[0] ?? null);
            void loadWorktrees();
          }}
        />
      )}
      {error && <div className="repo-banner error">{error}</div>}
      <div className="repo-body">
        <div className="wt-list">
          {checked.size > 0 && (
            <BulkBar
              checked={checked}
              groups={groups}
              base={data?.base}
              onClear={() => setChecked(new Set())}
              onRun={(kind) => {
                const want: BulkGroup = kind === "merge" ? "ready" : "empty";
                const items = worktrees
                  .filter((w) => checked.has(w.path) && groups.get(w.path)?.group === want)
                  .map((w) => ({ worktree: w, name: label(w, t), paneIds: (linkedPanes.get(w.path) ?? []).map((p) => p.id) }));
                if (items.length > 0) setBulk({ kind, items });
              }}
            />
          )}
          {worktrees
            .filter((w) => !groups.has(w.path))
            .map((w) => (
              <WorktreeRow key={w.path} w={w} active={current?.path === w.path} onSelect={() => setSelected(w.path)} noAgent={false} />
            ))}
          {(["ready", "empty", "busy"] as const).map((group) => {
            const members = worktrees.filter((w) => groups.get(w.path)?.group === group);
            if (members.length === 0) return null;
            const allChecked = members.every((w) => checked.has(w.path));
            return (
              <div key={group} className="wt-group">
                <div className={`wt-group-head ${group}`}>
                  <span>{t(`wt.bulk.group.${group}`)}</span>
                  <span className="wt-group-n">{members.length}</span>
                  <span className="wt-group-sp" />
                  {group !== "busy" && members.length > 1 && (
                    <button
                      type="button"
                      className="wt-group-all"
                      onClick={() =>
                        setChecked((cur) => {
                          const next = new Set(cur);
                          members.forEach((w) => (allChecked ? next.delete(w.path) : next.add(w.path)));
                          return next;
                        })
                      }
                    >
                      {allChecked ? t("wt.bulk.none") : t("wt.bulk.all")}
                    </button>
                  )}
                </div>
                {members.map((w) => (
                  <WorktreeRow
                    key={w.path}
                    w={w}
                    active={current?.path === w.path}
                    onSelect={() => setSelected(w.path)}
                    noAgent={isAbandoned(w, (linkedPanes.get(w.path) ?? []).length)}
                    reason={groups.get(w.path)?.reason}
                    checked={group === "busy" ? undefined : checked.has(w.path)}
                    onCheck={(on) =>
                      setChecked((cur) => {
                        const next = new Set(cur);
                        if (on) next.add(w.path);
                        else next.delete(w.path);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            );
          })}
          {data && linked.length === 0 && (
            <div className="repo-muted">
              {t("wt.view.emptyLinked")}
            </div>
          )}
        </div>
        {current && root !== null && repo !== null && (
          <WorktreeDetail
            key={current.path}
            worktree={current}
            root={root}
            repo={repo}
            base={data?.base}
            panes={linkedPanes.get(current.path) ?? []}
            onAction={(kind) => {
              const panes = linkedPanes.get(current.path) ?? [];
              setClosing({ kind, worktree: current, canCleanup: panes.length === 0 && !current.claudeSession?.alive });
            }}
          />
        )}
      </div>
      {bulk && repo !== null && root !== null && data?.base && (
        <BulkDialog
          kind={bulk.kind}
          repo={repo}
          base={data.base}
          items={bulk.items}
          repoParamOf={(path) => worktreeRepoParam(root, path)}
          onClose={() => {
            setBulk(null);
            setChecked(new Set());
          }}
          onDone={() => void loadWorktrees()}
        />
      )}
      {closing && repo !== null && root !== null && (
        <ClosingDialog
          repo={repo}
          root={root}
          base={data?.base}
          {...closing}
          onClose={() => setClosing(null)}
          onChanged={() => void loadWorktrees()}
        />
      )}
    </div>
  );
}

function WorktreeRow({
  w,
  active,
  onSelect,
  noAgent,
  reason,
  checked,
  onCheck,
}: {
  w: WorktreeInfo;
  active: boolean;
  onSelect: () => void;
  noAgent: boolean;
  /** Why it's in its bulk group ("3 cambios sin commitear", "ya integrado"…). */
  reason?: Msg;
  /** Undefined: no checkbox (the main checkout, or a worktree that can't be batched). */
  checked?: boolean;
  onCheck?: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const state = worktreeState(w);
  return (
    <div className={`wt-row-wrap${active ? " active" : ""}${checked ? " checked" : ""}`}>
      {checked !== undefined && (
        <input
          type="checkbox"
          className="wt-check"
          checked={checked}
          aria-label={t("wt.bulk.select", { name: label(w, t) })}
          onChange={(e) => onCheck?.(e.target.checked)}
        />
      )}
      <button type="button" className={`wt-row${active ? " active" : ""}`} onClick={onSelect}>
        <span className="wt-row-top">
          <span className="wt-name">{label(w, t)}</span>
          <span className="wt-chip">{t(ORIGIN_LABEL[w.origin])}</span>
          <span className={`wt-state ${state.tone}`}>{t(state.label.key, state.label.vars)}</span>
        </span>
        <span className="wt-sub">
          {reason ? t(reason.key, reason.vars) : (w.branch ?? t("wt.view.noBranch"))}
          {noAgent ? t("wt.view.noAgent") : ""}
        </span>
      </button>
    </div>
  );
}

/** Shows over the list while worktrees are checked: what each batch would act on. */
function BulkBar({
  checked,
  groups,
  base,
  onClear,
  onRun,
}: {
  checked: Set<string>;
  groups: Map<string, Grouped>;
  base?: string;
  onClear: () => void;
  onRun: (kind: "merge" | "remove") => void;
}) {
  const { t } = useI18n();
  const ready = [...checked].filter((p) => groups.get(p)?.group === "ready").length;
  const empty = [...checked].filter((p) => groups.get(p)?.group === "empty").length;
  return (
    <div className="wt-bulkbar">
      <div className="wt-bulkbar-sel">
        <span>{t(checked.size === 1 ? "wt.bulk.selectedOne" : "wt.bulk.selected", { count: checked.size })}</span>
        <button type="button" className="wt-group-all" onClick={onClear}>
          {t("wt.bulk.clear")}
        </button>
      </div>
      <div className="wt-bulkbar-row">
        {ready > 0 && base && (
          <button type="button" className="repo-btn primary small" onClick={() => onRun("merge")}>
            {t("wt.bulk.merge", { count: ready, base })}
          </button>
        )}
        {empty > 0 && (
          <button type="button" className="repo-btn danger small" onClick={() => onRun("remove")}>
            {t("wt.bulk.remove", { count: empty })}
          </button>
        )}
      </div>
    </div>
  );
}

function ClosingDialog({
  kind,
  worktree,
  canCleanup,
  repo,
  root,
  base,
  onClose,
  onChanged,
}: {
  kind: DialogKind;
  worktree: WorktreeInfo;
  canCleanup: boolean;
  repo: string;
  root: string;
  base?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  if (kind === "discard") return <DiscardDialog repo={repo} worktree={worktree} onClose={onClose} onDone={onChanged} />;
  if (!base) return null;
  if (kind === "merge") {
    return (
      <MergeDialog repo={repo} worktree={worktree} base={base} canCleanup={canCleanup} onClose={onClose} onDone={onChanged} />
    );
  }
  return (
    <PullRequestDialog
      repo={repo}
      commitsRepo={worktreeRepoParam(root, worktree.path)}
      worktree={worktree}
      base={base}
      onClose={onClose}
      onDone={onChanged}
    />
  );
}

function WorktreeDetail({
  worktree,
  root,
  repo,
  base,
  panes,
  onAction,
}: {
  worktree: WorktreeInfo;
  root: string;
  repo: string;
  base?: string;
  panes: TerminalPaneSummary[];
  /** Opens a closing dialog. They live in WorktreesView: a refresh can drop this detail while one is open. */
  onAction: (kind: DialogKind) => void;
}) {
  const { call } = useGateway();
  const { t } = useI18n();
  const reason = (m?: Msg) => (m ? t(m.key, m.vars) : undefined);
  const [tab, setTab] = useState<"live" | "changes" | "commits">(panes.length > 0 ? "live" : "changes");
  const [touched, setTouched] = useState(false);
  const [paneId, setPaneId] = useState<string | null>(null);
  // A pane can show up after the detail opened (a Claude session found by pid); until the user picks a tab, prefer the live one.
  useEffect(() => {
    if (!touched && panes.length > 0) setTab("live");
  }, [touched, panes.length]);
  const choose = (next: "live" | "changes" | "commits") => {
    setTouched(true);
    setTab(next);
  };
  const livePane = panes.find((p) => p.id === paneId) ?? panes[0] ?? null;
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The gateway only operates on repos inside the project root (or the repo's own checkout).
  const param = worktree.main ? repo : worktreeRepoParam(root, worktree.path);
  const state = worktreeState(worktree);
  const options = closeOptions(worktree, base, panes.length);
  const abandoned = isAbandoned(worktree, panes.length);

  useEffect(() => {
    if (param === null || worktree.missing) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [st, log] = await Promise.all([
          call<RepoStatus>("git.status2", { repo: param }),
          call<{ commits: CommitInfo[] }>("git.log", {
            repo: param,
            limit: LOG_LIMIT,
            ...(!worktree.main && base ? { ref: `${base}..HEAD` } : {}),
          }),
        ]);
        if (cancelled) return;
        setStatus(st);
        setCommits(log.commits);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [call, param, base, worktree.main, worktree.missing]);

  return (
    <div className="wt-detail">
      <div className="wt-detail-head">
        <div className="wt-detail-title">
          {label(worktree, t)}
          <span className="wt-chip">{t(ORIGIN_LABEL[worktree.origin])}</span>
          <span className={`wt-state ${state.tone}`}>{t(state.label.key, state.label.vars)}</span>
        </div>
        <div className="wt-detail-meta">
          {worktree.branch ?? "detached"} · {worktreeDisplayPath(root, worktree.path)}
          {!worktree.main && base ? ` · base ${base}` : ""}
        </div>
        {worktree.claudeSession && (
          <div className="wt-detail-meta">
            {t("wt.view.claudeSession", {
              name: worktree.claudeSession.name,
              pid: worktree.claudeSession.pid,
              state: worktree.claudeSession.alive ? t("wt.view.sessionAlive") : t("wt.view.sessionDead"),
            })}
          </div>
        )}
        {abandoned && (
          <div className="wt-abandoned">
            {t("wt.view.abandoned")}
          </div>
        )}
        {!worktree.main && (
          <div className="wt-actions">
            {param !== null && !worktree.missing && (
              <button
                type="button"
                className="repo-btn small"
                onClick={() => {
                  requestOpenRepo(param, worktree.path.split(/[\\/]/).pop() ?? param, worktree.branch);
                  setActiveTab("repository");
                }}
              >
                {t("wt.view.review")}
              </button>
            )}
            <button
              type="button"
              className="repo-btn small"
              disabled={!options.merge.allowed}
              title={reason(options.merge.reason)}
              onClick={() => onAction("merge")}
            >
              {t("wt.view.mergeInto", { base: base ?? t("wt.view.baseFallback") })}
            </button>
            <button
              type="button"
              className="repo-btn small"
              disabled={!options.pullRequest.allowed}
              title={reason(options.pullRequest.reason)}
              onClick={() => onAction("pr")}
            >
              {t("wt.view.publishPr")}
            </button>
            <button
              type="button"
              className="repo-btn small danger"
              disabled={!options.discard.allowed}
              title={reason(options.discard.reason)}
              onClick={() => onAction("discard")}
            >
              {t("wt.view.discard")}
            </button>
            {(options.merge.reason ?? options.discard.reason) && (
              <span className="wt-actions-why">{reason(options.merge.reason ?? options.discard.reason)}</span>
            )}
          </div>
        )}
      </div>
      {worktree.missing ? (
        <div className="repo-empty">{t("wt.view.missing")}</div>
      ) : param === null ? (
        <div className="repo-empty">
          {t("wt.view.outside")}
        </div>
      ) : (
        <>
          <div className="repo-tabs">
            {panes.length > 0 && (
              <button type="button" className={`repo-tab${tab === "live" ? " active" : ""}`} onClick={() => choose("live")}>
                {t("wt.view.tabLive")}
              </button>
            )}
            <button type="button" className={`repo-tab${tab === "changes" ? " active" : ""}`} onClick={() => choose("changes")}>
              {t("wt.view.tabChanges")}{status ? ` (${status.changes.length})` : ""}
            </button>
            <button type="button" className={`repo-tab${tab === "commits" ? " active" : ""}`} onClick={() => choose("commits")}>
              Commits{commits.length ? ` (${commits.length})` : ""}
            </button>
          </div>
          {error && <div className="repo-banner error">{error}</div>}
          <div className="wt-detail-body">
            {tab === "live" && livePane ? (
              <div className="wt-live">
                <div className="wt-live-bar">
                  {panes.length > 1 ? (
                    <select className="repo-select" value={livePane.id} onChange={(e) => setPaneId(e.target.value)}>
                      {panes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="wt-detail-meta">{livePane.title}</span>
                  )}
                  <span className="wt-detail-meta">{t("wt.view.liveHint")}</span>
                  <button
                    type="button"
                    className="repo-btn small"
                    onClick={() => {
                      setActiveTab("terminal");
                      requestFocusPane(livePane.id);
                    }}
                  >
                    {t("wt.view.goToPane")}
                  </button>
                </div>
                <TerminalMirror key={livePane.id} id={livePane.id} />
              </div>
            ) : tab === "changes" ? (
              status && status.changes.length > 0 ? (
                <ul className="repo-list">
                  {status.changes.map((c) => (
                    <li key={`${c.kind}:${c.path}`} className="repo-change">
                      <span className="repo-change-main">
                        <span className={`repo-letter l-${c.worktree === "." ? c.index : c.worktree}`}>
                          {c.worktree === "." ? c.index : c.worktree}
                        </span>
                        <span className="repo-change-name">{c.path}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="repo-muted">{t("wt.view.noChanges")}</div>
              )
            ) : commits.length > 0 ? (
              <ul className="repo-list">
                {commits.map((c) => (
                  <li key={c.sha} className="repo-commit">
                    <span className="repo-commit-main">
                      <span className="repo-commit-subject">{c.subject}</span>
                      <span className="repo-commit-meta">
                        {c.short} · {c.author} · {new Date(c.date).toLocaleString()}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="repo-muted">
                {worktree.main ? t("wt.view.noCommits") : t("wt.view.noCommitsAhead", { base: base ?? t("wt.view.baseFallback") })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
