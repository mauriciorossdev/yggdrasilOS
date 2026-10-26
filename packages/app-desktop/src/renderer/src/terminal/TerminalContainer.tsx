import { Fragment, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { PencilIcon, TrashIcon } from "@heroicons/react/20/solid";
import type { AgentTeam, PaneNode } from "../types.js";
import { collectLeaves, newLeaf, paneReducer, projectVisibleTree, type LeafPane } from "./paneTree.js";
import { TerminalPane } from "./TerminalPane.js";
import { liveOrphans } from "./liveOrphans.js";
import { requestTab } from "../chat/mainTabsBridge.js";
import { PaneDivider } from "./PaneDivider.js";
import type { TerminalRegistry } from "./terminalRegistry.js";
import { onLoadFlow, onLoadTeam, onNewTerminal, onTerminalTabVisible } from "./terminalBridge.js";
import { buildFlowLinks, setFlowLinks } from "./flowLinks.js";
import { buildFlowLeaves, selectTeamRootNodes } from "./buildFlowLeaves.js";
import { TerminalNavbar } from "./TerminalNavbar.js";
import { terminalLaunchClis } from "../onboarding/harnessFilter.js";
import { useOnboarding } from "../onboarding/store.js";
import { FeatureHeader } from "./FeatureHeader.js";
import { MinimizedDock } from "./MinimizedDock.js";
import { TerminalCanvasView } from "./TerminalCanvasView.js";

const SAVE_DEBOUNCE_MS = 400;
const MIN_PANE_FRACTION = 0.1;

function PaneNodeView({
  node,
  activePaneId,
  registry,
  dispatch,
  projectPath,
  onMinimize,
  mobileFocusedIds,
}: {
  node: PaneNode;
  activePaneId: string | null;
  registry: TerminalRegistry;
  dispatch: React.Dispatch<Parameters<typeof paneReducer>[1]>;
  projectPath: string | null;
  onMinimize: (id: string) => void;
  mobileFocusedIds: Set<string>;
}) {
  if (node.type === "leaf") {
    return (
      <TerminalPane
        leaf={node}
        registry={registry}
        projectPath={projectPath}
        active={node.id === activePaneId}
        onFocus={() => dispatch({ type: "FOCUS", id: node.id })}
        onRename={(title) => dispatch({ type: "RENAME", id: node.id, title })}
        onSplit={(direction) =>
          dispatch({ type: "SPLIT", targetId: node.id, direction, newLeaf: newLeaf(node.cwd, "Terminal") })
        }
        onClose={() => dispatch({ type: "CLOSE", id: node.id })}
        onMinimize={() => onMinimize(node.id)}
        onDelegated={(targetId) => dispatch({ type: "FOCUS", id: targetId })}
        dispatch={dispatch}
        mobileFocused={mobileFocusedIds.has(node.id)}
      />
    );
  }

  return (
    <div className={`pane-split ${node.direction}`}>
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <PaneDivider
              direction={node.direction}
              onResize={(delta) => {
                const sizes = [...node.sizes];
                const a = i - 1;
                const b = i;
                const applied = Math.max(-sizes[a]! + MIN_PANE_FRACTION, Math.min(delta, sizes[b]! - MIN_PANE_FRACTION));
                sizes[a] = sizes[a]! + applied;
                sizes[b] = sizes[b]! - applied;
                dispatch({ type: "RESIZE", splitId: node.id, sizes });
              }}
            />
          )}
          <div className="pane-slot" style={{ flexGrow: node.sizes[i], flexBasis: 0 }}>
            <PaneNodeView
              node={child}
              activePaneId={activePaneId}
              registry={registry}
              dispatch={dispatch}
              projectPath={projectPath}
              onMinimize={onMinimize}
              mobileFocusedIds={mobileFocusedIds}
            />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

export function TerminalContainer() {
  const [state, dispatch] = useReducer(paneReducer, { root: null, activePaneId: null });
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [savedTeams, setSavedTeams] = useState<AgentTeam[]>([]);
  const registryRef = useRef<TerminalRegistry>(new Map());
  const hydratedRef = useRef(false);

  // Which panes are minimized — deliberately NOT part of `state`/paneReducer:
  // state.root is what the disposal effect below diffs against to decide
  // when to actually kill a pty (terminals.dispose), so minimizing must
  // never remove a leaf from it — see projectVisibleTree's doc comment in
  // paneTree.ts. Purely a render-time filter, resets on reload same as
  // registryRef.
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(new Set());

  // Panes currently being viewed/controlled from a phone — main/terminals.ts's
  // expandTerminalForMobile widens the real pty while this is true, so the
  // dark "Focus on mobile" overlay (TerminalPane.tsx) tells anyone looking at
  // the desktop window why that specific pane just got wider/redrew.
  const [mobileFocusedIds, setMobileFocusedIds] = useState<Set<string>>(new Set());
  const visibleRoot = useMemo(() => projectVisibleTree(state.root, minimizedIds), [state.root, minimizedIds]);
  const viewMode = state.viewMode ?? "grid";
  const minimizePane = (id: string) => setMinimizedIds((prev) => new Set(prev).add(id));
  const restorePane = (id: string) => {
    setMinimizedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    dispatch({ type: "FOCUS", id });
  };

  const loadTeam = (team: AgentTeam) => {
    // Only the root(s) get a real pane — a worker only ever exists because
    // its orchestrator's own conversation called create_pane for it, and
    // that has no session-resume, so recreating N frozen worker panes and
    // hoping a note talks the orchestrator out of duplicating them is
    // fragile. Letting the root(s) recreate their team live is the same
    // path already proven to work on a genuine first run.
    const edges = team.edges ?? [];
    const roots = selectTeamRootNodes(team.nodes, edges);
    const { leaves } = buildFlowLeaves(roots, projectPath, edges, team.nodes);
    dispatch({ type: "LOAD_FLOW", leaves });
  };

  const deleteTeam = (team: AgentTeam) => {
    if (!window.confirm(`Delete team "${team.name}"? This can't be undone.`)) return;
    void window.yggdrasil.agentTeams.delete(team.id).then(setSavedTeams);
  };

  // Electron's renderer doesn't implement window.prompt() (only alert/
  // confirm) — it throws — so renaming needs its own inline input.
  const [renamingTeamId, setRenamingTeamId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");

  const startRenameTeam = (team: AgentTeam) => {
    setRenamingTeamId(team.id);
    setRenamingValue(team.name);
  };

  const submitRenameTeam = () => {
    const id = renamingTeamId;
    const name = renamingValue.trim();
    setRenamingTeamId(null);
    if (!id || !name) return;
    void window.yggdrasil.agentTeams.rename(id, name).then(setSavedTeams);
  };

  const onRenameTeamKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitRenameTeam();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setRenamingTeamId(null);
    }
  };

  const { settings: onboardingSettings } = useOnboarding();
  const launchClis = terminalLaunchClis(onboardingSettings);

  const startNewTerminal = (command?: string, title?: string) => {
    if (!projectPath) return;
    const leaf: LeafPane = { ...newLeaf(projectPath, command ? (title ?? command) : "Terminal 1"), command };
    dispatch({ type: "ADD_ROOT", leaf });
  };

  useEffect(() => {
    void window.yggdrasil.projects.list().then((list) => {
      const mine = list.find((p) => p.id === window.yggdrasil.projectId);
      setProjectPath(mine?.path ?? null);
    });
  }, []);

  // Hydrate the saved layout once we know the project root (needed as the
  // fallback cwd for the very first auto-created leaf on a brand new
  // project). Re-spawning a pty per restored leaf happens here too —
  // TerminalPane's own mount effect issues the terminals.create() call, so
  // this just needs to get the tree shape into state.
  useEffect(() => {
    if (hydratedRef.current || projectPath === null) return;
    hydratedRef.current = true;
    void Promise.all([
      window.yggdrasil.terminals.getLayout(),
      window.yggdrasil.agentFlow.get(),
      window.yggdrasil.agentTeams.list(),
      // Ptys still alive in main (an agent's create_pane workers survive a
      // window reload, but HYDRATE drops their saved leaves) — re-adopted below.
      window.yggdrasil.panes.list().catch(() => []),
    ]).then(([layout, flow, teams, livePanes]) => {
      if (layout.root) {
        dispatch({ type: "HYDRATE", layout });
        // Delegate buttons (flowLinks) are renderer-memory-only and don't
        // survive an app restart on their own — rebuild them here from the
        // persisted leaves' flowNodeId (set at "Load into Terminal" time)
        // matched against the current agent-flow.json, so a restarted
        // project window doesn't require re-clicking "Load into Terminal"
        // just to get Delegate buttons back.
        if (flow) {
          const nodeIdToLeafId = new Map<string, string>();
          for (const leaf of collectLeaves(layout.root)) {
            if (leaf.flowNodeId) nodeIdToLeafId.set(leaf.flowNodeId, leaf.id);
          }
          setFlowLinks(buildFlowLinks(flow, nodeIdToLeafId));
        }
      } else {
        // No restored layout — leave state.root null and let the user
        // choose (New terminal: Claude Code / system shell, or load a
        // saved Team if this project has any) via the empty state below.
        setSavedTeams(teams);
      }
      const orphans = liveOrphans([], livePanes);
      if (orphans.length > 0) dispatch({ type: "ADOPT_LIVE", leaves: orphans });
      setHydrated(true);
    });
  }, [projectPath]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void window.yggdrasil.terminals.saveLayout(state);
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  // Cross-tab trigger from AgentFlowView's "Load into Terminal" — see
  // terminalBridge.ts for why this is a pub-sub rather than lifted state.
  useEffect(() => onLoadFlow((leaves) => dispatch({ type: "LOAD_FLOW", leaves })), []);

  // MainTabs' persistent "Teams ▾" control — same replace-current-layout
  // semantics as "Load into Terminal", so confirm when there's something to
  // lose (the empty-state banner below skips this, nothing live yet there).
  useEffect(
    () =>
      onLoadTeam((team) => {
        if (state.root && !window.confirm(`Load team "${team.name}"? This replaces your current Terminal layout.`)) {
          return;
        }
        loadTeam(team);
      }),
    [state.root, projectPath],
  );

  // The Terminal tab just became visible (MainTabs) — any pane mounted
  // while it was display:none never got a real ResizeObserver fire, so its
  // pty is still sized at whatever it was created with and nothing painted.
  // Re-fit everything now that the containers have real dimensions.
  useEffect(
    () =>
      onTerminalTabVisible(() => {
        for (const [id, entry] of registryRef.current) {
          entry.fitAddon.fit();
          void window.yggdrasil.terminals.resize(id, entry.term.cols, entry.term.rows);
        }
      }),
    [],
  );

  const leaves = collectLeaves(state.root);
  // Same "minimized panes stay hidden" rule projectVisibleTree applies to
  // the grid's tree, flattened for TerminalCanvasView's flat node list.
  const canvasLeaves = leaves.filter((l) => !minimizedIds.has(l.id));

  // "Compact" navbar button — every open pane, not just the active one, so
  // running out of context doesn't require clicking into each pane in turn.
  const compactAllPanes = () => {
    for (const leaf of leaves) void window.yggdrasil.panes.write(leaf.id, "/compact", true);
  };

  // "Commands" navbar button — a leaf only carries `flowNodeId` when it was
  // materialized from an AgentFlowNode (buildFlowLeaves.ts); loadTeam above
  // only ever does that for the team's root(s) (selectTeamRootNodes), never
  // for workers a root spawns live via create_pane. So among currently open
  // panes, "has flowNodeId" already means "is this team's orchestrator" —
  // no separate bookkeeping needed. Falls back to whatever's active, then
  // the first pane, for a plain (non-team) layout.
  const sendCommandToOrchestrator = (command: string) => {
    const target = leaves.find((l) => l.flowNodeId) ?? leaves.find((l) => l.id === state.activePaneId) ?? leaves[0];
    if (target) void window.yggdrasil.panes.write(target.id, command, true);
  };

  // "+" next to the Terminal tab (MainTabs) triggers this instead of a
  // toolbar button living in here — see terminalBridge.ts.
  useEffect(
    () =>
      onNewTerminal(() => {
        if (!projectPath) return;
        const leaf = newLeaf(projectPath, `Terminal ${leaves.length + 1}`);
        if (!state.root) {
          dispatch({ type: "ADD_ROOT", leaf });
        } else {
          const targetId = state.activePaneId ?? leaves[0]?.id;
          if (targetId) dispatch({ type: "SPLIT", targetId, direction: "row", newLeaf: leaf });
        }
      }),
    [projectPath, state.root, state.activePaneId, leaves],
  );

  // An agent used the create_pane MCP tool (paneControlServer.ts) — its pty
  // already exists in the main process; draw it here rather than spawn a
  // second one (TerminalPane's `attach` handling).
  useEffect(
    () =>
      window.yggdrasil.terminals.onPaneCreated((pane) => {
        // A repeated event must not mount a second TerminalPane on the same pty.
        if (leaves.some((l) => l.id === pane.id)) {
          restorePane(pane.id);
          return;
        }
        const leaf: LeafPane = {
          type: "leaf",
          id: pane.id,
          title: pane.title,
          cwd: pane.cwd,
          command: pane.command,
          args: pane.args,
          attach: true,
        };
        if (!state.root) {
          dispatch({ type: "ADD_ROOT", leaf });
        } else {
          // Split next to the pane that actually called create_pane, not
          // whichever pane happens to have UI focus — otherwise the new
          // worker pane can land next to an unrelated pane the user was
          // just looking at, instead of beside its real orchestrator.
          const sourceStillOpen = pane.sourcePaneId && leaves.some((l) => l.id === pane.sourcePaneId);
          const targetId = (sourceStillOpen ? pane.sourcePaneId : undefined) ?? state.activePaneId ?? leaves[0]?.id;
          if (targetId) dispatch({ type: "SPLIT", targetId, direction: "row", newLeaf: leaf });
        }
      }),
    [state.root, state.activePaneId, leaves],
  );

  // show_pane (paneControlServer.ts): an agent asks for a live pane to be
  // visible — draw it if this window has no leaf for it (e.g. after a reload),
  // otherwise bring it out of the minimized dock and focus it.
  useEffect(
    () =>
      window.yggdrasil.terminals.onPaneShow((pane) => {
        if (leaves.some((l) => l.id === pane.id)) restorePane(pane.id);
        else {
          dispatch({
            type: "ADOPT_LIVE",
            leaves: [{ type: "leaf", id: pane.id, title: pane.title, cwd: pane.cwd, command: pane.command, attach: true }],
          });
          dispatch({ type: "FOCUS", id: pane.id });
        }
        requestTab("terminal");
      }),
    [leaves],
  );

  useEffect(
    () =>
      window.yggdrasil.terminals.onMobileFocus((id, active) => {
        setMobileFocusedIds((prev) => {
          if (active === prev.has(id)) return prev;
          const next = new Set(prev);
          if (active) next.add(id);
          else next.delete(id);
          return next;
        });
      }),
    [],
  );

  // The one real disposal point: a leaf that's no longer in the tree (an
  // actual CLOSE, not a split/resize elsewhere causing a transient remount
  // — see TerminalPane/terminalRegistry) gets its terminal/pty torn down
  // for real. Compares against `registryRef`'s own keys rather than
  // reacting to individual TerminalPane mount/unmount, so it fires exactly
  // once per genuine close regardless of how much re-rendering a split
  // elsewhere causes.
  useEffect(() => {
    const liveIds = new Set(leaves.map((l) => l.id));
    for (const [id, entry] of registryRef.current) {
      if (liveIds.has(id)) continue;
      entry.unsubData?.();
      entry.unsubExit?.();
      entry.unsubTheme?.();
      entry.term.dispose();
      void window.yggdrasil.terminals.dispose(id);
      registryRef.current.delete(id);
    }
    // A pane closed for real while minimized would otherwise leak its id in
    // minimizedIds forever (harmless — projectVisibleTree only ever filters
    // ids actually present in state.root — but no reason to let the Set
    // grow unbounded across a long session).
    setMinimizedIds((prev) => {
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.root]);

  return (
    <div className="terminal-container">
      <TerminalNavbar
        disabled={!state.root}
        onArrange={(layout) => dispatch({ type: "ARRANGE", layout })}
        viewMode={viewMode}
        onToggleViewMode={() => dispatch({ type: "SET_VIEW_MODE", mode: viewMode === "canvas" ? "grid" : "canvas" })}
        onCompactAll={compactAllPanes}
        onSendCommand={sendCommandToOrchestrator}
      />
      <FeatureHeader />
      <div className={`terminal-body${visibleRoot ? "" : " terminal-body-empty"}`}>
        {!hydrated ? (
          <p className="muted">Loading terminal…</p>
        ) : viewMode === "canvas" && state.root ? (
          <TerminalCanvasView
            leaves={canvasLeaves}
            activePaneId={state.activePaneId}
            registry={registryRef.current}
            projectPath={projectPath}
            dispatch={dispatch}
            onMinimize={minimizePane}
            mobileFocusedIds={mobileFocusedIds}
          />
        ) : visibleRoot ? (
          <PaneNodeView
            node={visibleRoot}
            activePaneId={state.activePaneId}
            registry={registryRef.current}
            projectPath={projectPath}
            dispatch={dispatch}
            onMinimize={minimizePane}
            mobileFocusedIds={mobileFocusedIds}
          />
        ) : state.root ? (
          <p className="muted">All terminals minimized — restore one from the dock below.</p>
        ) : (
          <div className="terminal-team-banner">
            <p className="muted">New terminal</p>
            <div className="terminal-team-banner-list">
              {launchClis.map((cli) => (
                <button
                  key={cli.id}
                  type="button"
                  className="new-chat"
                  onClick={() => startNewTerminal(cli.command, cli.id === "claude" ? "claude" : cli.command)}
                >
                  {cli.label}
                </button>
              ))}
              <button type="button" className="new-chat" onClick={() => startNewTerminal()}>
                System shell
              </button>
            </div>
            {savedTeams.length > 0 && (
              <>
                <p className="muted">
                  {savedTeams.length === 1 ? "1 saved team" : `${savedTeams.length} saved teams`} for this project
                </p>
                <div className="terminal-team-banner-list">
                  {savedTeams.map((team) =>
                    renamingTeamId === team.id ? (
                      <input
                        key={team.id}
                        className="context-menu-input"
                        value={renamingValue}
                        onChange={(e) => setRenamingValue(e.target.value)}
                        onKeyDown={onRenameTeamKeyDown}
                        onBlur={submitRenameTeam}
                        autoFocus
                      />
                    ) : (
                      <div key={team.id} className="terminal-team-row">
                        <button type="button" className="new-chat" onClick={() => loadTeam(team)}>
                          Load "{team.name}" ({team.nodes.length})
                        </button>
                        <button type="button" className="icon-btn" title="Rename team" onClick={() => startRenameTeam(team)}>
                          <PencilIcon className="hero-icon" />
                        </button>
                        <button type="button" className="icon-btn" title="Delete team" onClick={() => deleteTeam(team)}>
                          <TrashIcon className="hero-icon" />
                        </button>
                      </div>
                    ),
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {minimizedIds.size > 0 && (
        <MinimizedDock panes={leaves.filter((l) => minimizedIds.has(l.id))} onRestore={restorePane} />
      )}
    </div>
  );
}
