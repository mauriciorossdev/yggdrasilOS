import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { AgentFlow, AgentFlowEdge, AgentFlowNode, AgentInfo, AgentTeam, ChatSendResult } from "../types.js";
import { AgentFlowCanvas } from "./AgentFlowCanvas.js";
import { NodeConfigDrawer } from "./NodeConfigDrawer.js";
import { SupervisorPanel } from "./SupervisorPanel.js";
import { ConnectionsPanel } from "./ConnectionsPanel.js";
import { UnsavedChangesModal } from "./UnsavedChangesModal.js";
import { TeamsMenu } from "../terminal/TeamsMenu.js";
import { buildAgentFlowEdgeMap } from "./buildFlowEdgeMap.js";
import { useAgentFlowRunEvents } from "./useAgentFlowRunEvents.js";
import { requestLoadFlow } from "../terminal/terminalBridge.js";
import type { LeafPane } from "../terminal/paneTree.js";
import { requestTerminalTab } from "../chat/mainTabsBridge.js";
import { buildFlowLinks, setFlowLinks } from "../terminal/flowLinks.js";
import { buildFlowLeaves } from "../terminal/buildFlowLeaves.js";

function emptyFlow(): AgentFlow {
  return { version: 1, name: "Default Flow", nodes: [], edges: [], supervisor: { type: "human" }, updatedAt: Date.now() };
}

// Excludes `updatedAt` — the only derived/timestamp field on AgentFlow, reset
// to Date.now() by save()/openTeam()/emptyFlow() every time, so including it
// would make every fresh load or clean save register as "dirty" the instant
// something else touches the clock.
function snapshotFlow(flow: AgentFlow | null): string | null {
  if (!flow) return null;
  const { updatedAt: _updatedAt, ...rest } = flow;
  return JSON.stringify(rest);
}

// Not wired up to anything useful yet — hidden until it is, kept in code
// rather than deleted since runFlow()/canRunFlow below still work.
const SHOW_RUN_FLOW = false;

// Staggered grid so successive "+ Add Node" clicks don't stack new boxes
// directly on top of each other on the canvas.
const GRID_COLS = 3;
const GRID_STEP_X = 320;
const GRID_STEP_Y = 260;

function newNode(index: number): AgentFlowNode {
  return {
    id: crypto.randomUUID(),
    name: `Agent ${index + 1}`,
    position: { x: (index % GRID_COLS) * GRID_STEP_X, y: Math.floor(index / GRID_COLS) * GRID_STEP_Y },
    harness: { type: "yggdrasil", agentId: "" },
  };
}

// Live counterpart to buildFlowLeaves.ts's withTeamRosterNote — that one
// builds the same kind of note fresh, in-memory, only at Team-reload launch
// time. This persists it directly into the spawning node's own stored
// initialPrompt as each child actually appears, one line at a time, so it
// shows up in NodeConfigDrawer and survives a "Save Flow".
const TEAM_ROSTER_MARKER = "--- Your team (spawned by you) ---";

function appendRosterLine(initialPrompt: string | undefined, childName: string, task: string): string {
  const line = `- ${childName}: ${task || "(no stated task)"}`;
  const base = initialPrompt ?? "";
  if (base.includes(TEAM_ROSTER_MARKER)) return `${base}\n${line}`;
  return [base, TEAM_ROSTER_MARKER, line].filter((s) => s !== "").join("\n");
}

export function AgentFlowView() {
  const { call, onEvent } = useGateway();
  const [flow, setFlow] = useState<AgentFlow | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Edge ids currently pulsing (write_pane just fired between the two nodes
  // it connects) — purely a transient visual cue, each entry clears itself
  // via its own timeout a beat after being added. See onCommunication below.
  const [activeEdgeIds, setActiveEdgeIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runSessionKey, setRunSessionKey] = useState<string | null>(null);
  // Electron's renderer doesn't implement window.prompt() (only alert/
  // confirm) — it throws — so "Save as Team…" needs its own inline input.
  // null = closed; a string = the draft name being typed.
  const [teamNameDraft, setTeamNameDraft] = useState<string | null>(null);
  // The id of the team currently loaded on the canvas (via "Open Team ▾"),
  // if any — "Save as Team…" reuses it so a re-save overwrites that same
  // team (saveAgentTeam upserts by id) instead of forking a new one each
  // time. Cleared by "+ New Agent Flow", since that starts a blank canvas.
  const [openedTeamId, setOpenedTeamId] = useState<string | null>(null);

  // Snapshot of the last loaded/saved flow (see snapshotFlow) — compared
  // against the live `flow` to decide if "+ New Agent Flow"/"Open Team ▾"
  // need to confirm before replacing the canvas. A ref, not state: read
  // on-demand at click time, doesn't need its own re-render.
  const savedSnapshotRef = useRef<string | null>(null);
  // Presence (not null) is what shows UnsavedChangesModal — holds the action
  // to run once the user picks Save or Discard.
  const [pendingProceed, setPendingProceed] = useState<(() => void) | null>(null);
  const [unsavedModalSaving, setUnsavedModalSaving] = useState(false);
  const [unsavedModalError, setUnsavedModalError] = useState<string | null>(null);

  const nodeIdByAgentId = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of flow?.nodes ?? []) {
      if (node.harness.type === "yggdrasil" && node.harness.agentId) map.set(node.harness.agentId, node.id);
    }
    return map;
  }, [flow?.nodes]);

  const { runningNodeIds, subSessionKeyByAgentId } = useAgentFlowRunEvents(onEvent, runSessionKey, nodeIdByAgentId);

  // Populated by runFlow() when it pre-spawns one pane per participating
  // yggdrasil node; consumed below to respawn a specific node's pane in
  // place once we learn its real sub-session key (agentflow.delegate.start).
  const leafIdByNodeIdRef = useRef<Map<string, string>>(new Map());
  const respawnedAgentIdsRef = useRef<Set<string>>(new Set());

  // A real pane's id (paneControlServer.ts mints a fresh one per
  // create_pane call) is only ever equal to its canvas node's id when that
  // node didn't already exist — i.e. auto-capture created it fresh. When it
  // instead matched an existing role-picker placeholder (same source, same
  // name — see the dedup below), the placeholder keeps its own older id
  // forever; nothing else ever learns "this live pane IS that node".
  // Without this map, a later write_pane from/to that pane resolves to its
  // own real id, which matches no node on canvas — onCommunication (below)
  // silently finds nothing to connect, exactly the "never saw a connection"
  // symptom this exists to fix. Populated only on the dedup path; a freshly
  // created node needs no entry since its id already equals node.id.
  const paneIdAliasRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    for (const [agentId, subSessionKey] of subSessionKeyByAgentId) {
      if (respawnedAgentIdsRef.current.has(agentId)) continue;
      const nodeId = nodeIdByAgentId.get(agentId);
      const leafId = nodeId ? leafIdByNodeIdRef.current.get(nodeId) : undefined;
      if (!leafId) continue;
      respawnedAgentIdsRef.current.add(agentId);
      // Same terminal:create IPC call TerminalPane's own restart() uses —
      // dispatched directly here since the live xterm registry lives inside
      // TerminalContainer, out of this view's reach. disposeTerminal (main
      // process) detaches the old pty's exit listener before killing it, so
      // this "recreate in place" never flashes a spurious [process exited].
      void window.yggdrasil.terminals.create({
        id: leafId,
        cwd: projectPath ?? ".",
        cols: 80,
        rows: 24,
        yggdrasilAgentId: agentId,
        sessionKey: subSessionKey,
        readOnly: true,
      });
    }
  }, [subSessionKeyByAgentId, nodeIdByAgentId, projectPath]);

  useEffect(() => {
    void window.yggdrasil.agentFlow.get().then((loaded) => {
      const initial = loaded ?? emptyFlow();
      setFlow(initial);
      savedSnapshotRef.current = snapshotFlow(initial);
    });
  }, []);

  // Live mirror of create_pane's auto-capture (paneControlServer.ts) — while
  // this view is mounted, a role-bearing agent spawned by another (e.g. an
  // orchestrator running in the Terminal tab) drops onto the canvas as its
  // own node, connected by an edge from whichever node spawned it, without
  // needing "Open Team ▾" to pull in the agent-teams.json snapshot it was
  // also persisted to. Purely an in-memory canvas edit — same as any manual
  // drag/add, it only reaches disk via an explicit "Save Flow".
  useEffect(() => {
    return window.yggdrasil.agentFlow.onAutoCapture(({ node, source }) => {
      setFlow((current) => {
        if (!current) return current;

        const nodes = [...current.nodes];
        const edges = [...current.edges];

        // Same alias translation as onCommunication below — if the source
        // pane is itself an already-aliased node (e.g. Backend Engineer,
        // matched to an existing placeholder when IT was captured), its own
        // real pane id still won't match its canvas node's id here without
        // this, silently spawning a duplicate "Backend Engineer" stub the
        // moment it creates a sub-agent of its own.
        const resolvedSourceId = source ? (paneIdAliasRef.current.get(source.id) ?? source.id) : undefined;
        let sourceNode = resolvedSourceId ? nodes.find((n) => n.id === resolvedSourceId) : undefined;
        if (source && !sourceNode) {
          sourceNode = {
            id: resolvedSourceId!,
            name: source.name,
            position: {
              x: (nodes.length % GRID_COLS) * GRID_STEP_X,
              y: Math.floor(nodes.length / GRID_COLS) * GRID_STEP_Y,
            },
            harness: { type: "claude" },
          };
          nodes.push(sourceNode);
        }

        // A live pane's id is always fresh (paneControlServer.ts mints a
        // new one per create_pane call) — it never matches a node the role
        // picker (AgentTemplatePicker → createRoleNode) already placed for
        // the same role, so id-based dedup alone would double up every
        // node an orchestrator was told to "instantiate" after already
        // being sketched out by hand. Same-source + same-name is the
        // matching key instead — a real pane an orchestrator creates for a
        // role already sketched on the canvas is treated as that node
        // actually showing up live, not a second one.
        const nameKey = (n: string) => n.trim().toLowerCase();
        const existingChild = sourceNode
          ? nodes.find(
              (n) =>
                edges.some((e) => e.from === sourceNode!.id && e.to === n.id) && nameKey(n.name) === nameKey(node.name),
            )
          : nodes.find((n) => n.id === node.id);
        if (existingChild) {
          if (existingChild.id !== node.id) paneIdAliasRef.current.set(node.id, existingChild.id);
          return { ...current, nodes, edges };
        }

        // Stack same-source siblings vertically instead of stacking them
        // directly on top of each other when one orchestrator spawns
        // several in a row.
        const siblingCount = sourceNode ? edges.filter((e) => e.from === sourceNode!.id).length : 0;
        const position = sourceNode
          ? { x: sourceNode.position.x + GRID_STEP_X, y: sourceNode.position.y + siblingCount * GRID_STEP_Y }
          : {
              x: (nodes.length % GRID_COLS) * GRID_STEP_X,
              y: Math.floor(nodes.length / GRID_COLS) * GRID_STEP_Y,
            };

        nodes.push({
          id: node.id,
          name: node.name,
          position,
          harness: { type: "claude", initialPrompt: node.initialPrompt },
        });

        if (sourceNode) {
          edges.push({ id: crypto.randomUUID(), from: sourceNode.id, to: node.id });

          // The spawning node's own initial prompt keeps a running roster
          // of everyone it's created — meaningless for a yggdrasil node
          // (its prompt comes from the agent's own config, not a per-node
          // field), so skipped there.
          if (sourceNode.harness.type !== "yggdrasil") {
            const sourceIndex = nodes.findIndex((n) => n.id === sourceNode!.id);
            nodes[sourceIndex] = {
              ...sourceNode,
              harness: {
                ...sourceNode.harness,
                initialPrompt: appendRosterLine(sourceNode.harness.initialPrompt, node.name, node.initialPrompt),
              },
            };
          }
        }

        return { ...current, nodes, edges };
      });
    });
  }, []);

  // Live "who's talking to whom" — write_pane firing between two nodes
  // already on the canvas pulses the edge connecting them, however that
  // edge got there (auto-capture, the role picker, or hand-drawn). Two
  // siblings (both children of the same node, no edge between each other)
  // talking directly have no edge to pulse yet — this draws one on the fly
  // rather than losing that communication entirely, same "make real
  // activity visible" instinct as auto-capture above. Nothing happens if
  // either end isn't a node on the canvas at all (a communication event
  // carries no name/role to also invent a missing node from).
  useEffect(() => {
    return window.yggdrasil.agentFlow.onCommunication((raw) => {
      // Translate through the same alias map onAutoCapture populates — a
      // pane's real id only equals its canvas node's id when auto-capture
      // never had to fall back to an existing role-picker placeholder.
      const from = paneIdAliasRef.current.get(raw.from) ?? raw.from;
      const to = paneIdAliasRef.current.get(raw.to) ?? raw.to;
      let pulseEdgeId: string | null = null;

      setFlow((current) => {
        if (!current) return current;

        const existing = current.edges.find((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from));
        if (existing) {
          pulseEdgeId = existing.id;
          return current;
        }

        if (!current.nodes.some((n) => n.id === from) || !current.nodes.some((n) => n.id === to)) return current;

        const newEdge: AgentFlowEdge = { id: crypto.randomUUID(), from, to };
        pulseEdgeId = newEdge.id;
        return { ...current, edges: [...current.edges, newEdge] };
      });

      if (!pulseEdgeId) return;
      const edgeId = pulseEdgeId;
      setActiveEdgeIds((prev) => new Set(prev).add(edgeId));
      setTimeout(() => {
        setActiveEdgeIds((prev) => {
          if (!prev.has(edgeId)) return prev;
          const next = new Set(prev);
          next.delete(edgeId);
          return next;
        });
      }, 1500);
    });
  }, []);

  const refreshTeams = useCallback(() => {
    void window.yggdrasil.agentTeams.list().then(setTeams);
  }, []);

  useEffect(() => refreshTeams(), [refreshTeams]);

  // Same lookup TerminalContainer performs — needed as the cwd for spawned
  // leaves ("Load into Terminal").
  useEffect(() => {
    void window.yggdrasil.projects.list().then((list) => {
      const mine = list.find((p) => p.id === window.yggdrasil.projectId);
      setProjectPath(mine?.path ?? null);
    });
  }, []);

  const refreshAgents = useCallback(() => {
    void call<{ agents: AgentInfo[] }>("agents.list")
      .then((res) => setAgents(res.agents ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [call]);

  useEffect(() => refreshAgents(), [refreshAgents]);

  if (!flow) return <p className="muted">Loading Agent Flow…</p>;

  // Functional updater — AgentTemplatePicker's toggle() calls this (via
  // onChange) and createRoleNode below back-to-back in the same handler.
  // Two plain-object setFlow({...flow, ...}) calls in one tick both read
  // the same pre-handler `flow` closure, so the second would fully
  // overwrite the first's result instead of composing with it (React's
  // batching doesn't merge separate setState calls — only the last one
  // "wins"). The functional form runs each updater against whatever the
  // previous one just produced, so both actually land.
  const updateNode = (updated: AgentFlowNode) =>
    setFlow((current) =>
      current ? { ...current, nodes: current.nodes.map((n) => (n.id === updated.id ? updated : n)) } : current,
    );

  const removeNode = (id: string) => {
    setFlow({ ...flow, nodes: flow.nodes.filter((n) => n.id !== id) });
    setSelectedNodeId((current) => (current === id ? null : current));
  };

  const addNode = () => setFlow({ ...flow, nodes: [...flow.nodes, newNode(flow.nodes.length)] });

  // AgentTemplatePicker (NodeConfigDrawer) picking a role — same visual
  // "spawner → child, connected by an edge" shape as the live create_pane
  // auto-capture above, just triggered by hand instead of a runtime event.
  // Idempotent by name: re-picking the same role for the same node (its
  // marker toggles back on after being removed and re-added) doesn't spawn
  // a second node.
  const createRoleNode = (sourceId: string, role: { label: string; prompt: string }) => {
    setFlow((current) => {
      if (!current) return current;
      const source = current.nodes.find((n) => n.id === sourceId);
      if (!source) return current;

      const alreadyExists = current.edges.some(
        (e) => e.from === source.id && current.nodes.find((n) => n.id === e.to)?.name === role.label,
      );
      if (alreadyExists) return current;

      const siblingCount = current.edges.filter((e) => e.from === source.id).length;
      const position = { x: source.position.x + GRID_STEP_X, y: source.position.y + siblingCount * GRID_STEP_Y };
      const childId = crypto.randomUUID();

      return {
        ...current,
        nodes: [
          ...current.nodes,
          // The role template is a persona/identity description ("you are
          // a Senior Backend Engineer, responsible for...") — it belongs in
          // systemPromptAppend (--append-system-prompt), not initialPrompt.
          // initialPrompt is what "Start Task" literally types as the
          // pane's first message; setting it to the raw role block sent the
          // whole persona description AS the task, with no actual ask in
          // it — the agent (correctly) had nothing to do but ask what the
          // task even was. Leaving initialPrompt unset also means "Start
          // Task" simply doesn't show until someone gives this node a real
          // task, same as any other freshly added node.
          { id: childId, name: role.label, position, harness: { type: "claude", systemPromptAppend: role.prompt } },
        ],
        edges: [...current.edges, { id: crypto.randomUUID(), from: source.id, to: childId }],
      };
    });
  };

  const updateEdges = (edges: AgentFlowEdge[]) => setFlow({ ...flow, edges });

  const createAgentInline = (id: string) => {
    void call("agents.create", { id, scope: "local" })
      .then(() => refreshAgents())
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const deleteAgentInline = (id: string) => {
    const agent = agents.find((a) => a.id === id);
    if (!window.confirm(`Delete agent "${agent?.label ?? id}"? This can't be undone.`)) return;
    void call("agents.delete", { id, scope: agent?.scope ?? "local" })
      .then(() => {
        refreshAgents();
        // Any node still pointing at the now-deleted agent would otherwise
        // silently reference a dangling id — clear it back to "(select an
        // agent)" the same way a fresh yggdrasil node starts out.
        setFlow((current) =>
          current
            ? {
                ...current,
                nodes: current.nodes.map((n) =>
                  n.harness.type === "yggdrasil" && n.harness.agentId === id
                    ? { ...n, harness: { type: "yggdrasil", agentId: "" } }
                    : n,
                ),
                supervisor:
                  current.supervisor.type === "yggdrasil" && current.supervisor.agentId === id
                    ? { ...current.supervisor, agentId: undefined }
                    : current.supervisor,
              }
            : current,
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  // Returns the failure message on error (undefined on success) —
  // handleUnsavedSave (below) needs this directly rather than reading
  // `error` state afterward, since that state closure would still be stale
  // right after the setError call that produced it. The toolbar's own "Save
  // Flow" button still just fires this and reads `error`/`saveMessage` state
  // as before, ignoring the return value.
  const save = async (): Promise<string | undefined> => {
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const toSave: AgentFlow = { ...flow, updatedAt: Date.now() };
      await window.yggdrasil.agentFlow.save(toSave);
      setFlow(toSave);
      savedSnapshotRef.current = snapshotFlow(toSave);
      setSaveMessage("Saved");
      setTimeout(() => setSaveMessage(null), 2000);
      return undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return message;
    } finally {
      setSaving(false);
    }
  };

  const isFlowDirty = () => flow !== null && snapshotFlow(flow) !== savedSnapshotRef.current;

  // Runs `proceed` immediately when the canvas has no unsaved changes;
  // otherwise shows the Save/Discard/Cancel modal and defers `proceed` until
  // the user picks Save or Discard (Cancel just closes it, changing nothing).
  const confirmIfDirty = (proceed: () => void) => {
    if (isFlowDirty()) {
      setUnsavedModalError(null);
      setPendingProceed(() => proceed);
    } else {
      proceed();
    }
  };

  const handleUnsavedSave = async () => {
    setUnsavedModalSaving(true);
    setUnsavedModalError(null);
    // save() swallows its own errors into `error` state rather than
    // throwing — it returns the failure message directly instead, since
    // reading `error` state right after would still see this render's
    // (stale) closure value, not what setError() just set.
    const failureMessage = await save();
    setUnsavedModalSaving(false);
    if (failureMessage) {
      setUnsavedModalError(failureMessage);
      return;
    }
    pendingProceed?.();
    setPendingProceed(null);
  };

  const handleUnsavedDiscard = () => {
    pendingProceed?.();
    setPendingProceed(null);
  };

  const handleUnsavedCancel = () => {
    setPendingProceed(null);
    setUnsavedModalError(null);
  };

  const newFlow = () => {
    confirmIfDirty(() => {
      const fresh = emptyFlow();
      setFlow(fresh);
      setSelectedNodeId(null);
      setOpenedTeamId(null);
      setError(null);
      setSaveMessage(null);
      savedSnapshotRef.current = snapshotFlow(fresh);
    });
  };

  const saveAsTeam = async (name: string) => {
    const trimmed = name.trim();
    if (flow.nodes.length === 0 || !trimmed) return;
    const id = openedTeamId ?? crypto.randomUUID();
    try {
      await window.yggdrasil.agentTeams.save({ id, name: trimmed, nodes: flow.nodes });
      setOpenedTeamId(id);
      setSaveMessage(`Saved as team "${trimmed}"`);
      setTimeout(() => setSaveMessage(null), 2000);
      refreshTeams();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openTeam = (team: AgentTeam) => {
    confirmIfDirty(() => {
      // Deliberately doesn't touch savedSnapshotRef, unlike newFlow() — a
      // just-loaded team isn't persisted to agent-flow.json yet, so it must
      // stay flagged dirty until an explicit Save Flow.
      setFlow({
        version: 1,
        name: team.name,
        nodes: team.nodes,
        edges: (team.edges ?? []).map((e) => ({ id: crypto.randomUUID(), from: e.from, to: e.to })),
        supervisor: { type: "human" },
        updatedAt: Date.now(),
      });
      setOpenedTeamId(team.id);
      setSelectedNodeId(null);
    });
  };

  const loadIntoTerminal = () => {
    if (flow.nodes.length === 0) return;
    if (!window.confirm("This replaces your current Terminal layout with one pane per Agent Flow node. Continue?")) {
      return;
    }
    const { leaves, nodeIdToLeafId } = buildFlowLeaves(flow.nodes, projectPath, flow.edges);
    requestLoadFlow(leaves);
    setFlowLinks(buildFlowLinks(flow, nodeIdToLeafId));
    requestTerminalTab();
  };

  const canRunFlow = flow.supervisor.type === "yggdrasil" && !!flow.supervisor.agentId;

  const runFlow = async () => {
    if (!canRunFlow) return;
    if (!flow.supervisor.initialPrompt?.trim()) {
      setError('Add an "Initial prompt" in the Supervisor panel before running the flow.');
      return;
    }
    if (!window.confirm("This replaces your current Terminal layout with live panes for this run. Continue?")) {
      return;
    }
    setError(null);
    const sessionKey = `agentflow:default:run-${crypto.randomUUID()}`;

    // Pre-spawn a pane per participating yggdrasil node up front (their real
    // sub-session key isn't known until the supervisor actually delegates to
    // them — see the respawn effect above) plus one for the supervisor
    // itself, joined to the run's session immediately since that one *is*
    // known now.
    const cwd = projectPath ?? ".";
    const yggdrasilNodes = flow.nodes.filter(
      (n): n is AgentFlowNode & { harness: { type: "yggdrasil"; agentId: string } } =>
        n.harness.type === "yggdrasil" && !!n.harness.agentId,
    );
    const nodeIdToLeafId = new Map<string, string>(yggdrasilNodes.map((node) => [node.id, crypto.randomUUID()]));
    leafIdByNodeIdRef.current = nodeIdToLeafId;
    respawnedAgentIdsRef.current = new Set();

    const leaves: LeafPane[] = [
      {
        type: "leaf",
        id: crypto.randomUUID(),
        title: "Supervisor",
        cwd,
        yggdrasilAgentId: flow.supervisor.agentId,
        sessionKey,
        readOnly: true,
      },
      ...yggdrasilNodes.map((node) => ({
        type: "leaf" as const,
        id: nodeIdToLeafId.get(node.id)!,
        title: node.name,
        cwd,
        yggdrasilAgentId: node.harness.agentId,
        flowNodeId: node.id,
      })),
    ];
    requestLoadFlow(leaves);
    requestTerminalTab();

    setRunSessionKey(sessionKey);
    setRunning(true);
    try {
      await call<ChatSendResult>(
        "chat.send",
        {
          message: flow.supervisor.initialPrompt,
          sessionKey,
          agentId: flow.supervisor.agentId,
          channelId: "agentflow",
          accountId: "default",
          senderId: "supervisor",
          metadata: { agentFlowEdges: buildAgentFlowEdgeMap(flow) },
        },
        // Same generous, non-fatal-on-timeout posture as ChatView's send() —
        // the run keeps going server-side and progress still arrives via
        // turn.start/turn.end regardless of whether this ack lands in time.
        { timeoutMs: 180_000 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.startsWith("Timeout:")) setError(`Run Flow failed: ${msg}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="agent-flow-view">
      <div className="agent-flow-toolbar">
        <button type="button" className="agent-flow-toolbar-btn" onClick={newFlow}>
          + New Agent Flow
        </button>
        <button type="button" className="agent-flow-toolbar-btn" onClick={addNode}>
          + Add Node
        </button>
        <button type="button" className="agent-flow-toolbar-btn" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save Flow"}
        </button>
        <button
          type="button"
          className="agent-flow-toolbar-btn"
          onClick={loadIntoTerminal}
          disabled={flow.nodes.length === 0}
        >
          Load into Terminal
        </button>
        {teamNameDraft === null ? (
          <button
            type="button"
            className="agent-flow-toolbar-btn"
            onClick={() => setTeamNameDraft(flow.name || "New Team")}
            disabled={flow.nodes.length === 0}
          >
            Save as Team…
          </button>
        ) : (
          <input
            className="context-menu-input"
            value={teamNameDraft}
            autoFocus
            onChange={(e) => setTeamNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const value = teamNameDraft;
                setTeamNameDraft(null);
                void saveAsTeam(value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setTeamNameDraft(null);
              }
            }}
            onBlur={() => {
              const value = teamNameDraft;
              setTeamNameDraft(null);
              if (value) void saveAsTeam(value);
            }}
          />
        )}
        <TeamsMenu teams={teams} label="Open Team" title="Open a saved team on this canvas" onLoad={openTeam} onDeleted={setTeams} />
        {SHOW_RUN_FLOW && (
          <button
            type="button"
            className="agent-flow-toolbar-btn"
            onClick={() => void runFlow()}
            disabled={!canRunFlow || running}
            title={canRunFlow ? undefined : "Needs a yggdrasil supervisor with an agent selected"}
          >
            {running ? "Running…" : "Run Flow"}
          </button>
        )}
        {saveMessage && <span className="mcp-status-ok">{saveMessage}</span>}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="agent-flow-body">
        <div className="agent-flow-canvas-area">
          <div className="agent-flow-team-label" title={openedTeamId ? "Open team" : "Unsaved flow — no team open"}>
            {openedTeamId ? flow.name : `${flow.name} (unsaved)`}
          </div>
          {flow.nodes.length === 0 ? (
            <div className="agent-flow-canvas-empty">
              <p className="muted">No nodes yet — add one to get started.</p>
            </div>
          ) : (
            <AgentFlowCanvas
              nodes={flow.nodes}
              edges={flow.edges}
              selectedNodeId={selectedNodeId}
              runningNodeIds={runningNodeIds}
              activeEdgeIds={activeEdgeIds}
              onNodesChange={(nodes) => setFlow({ ...flow, nodes })}
              onEdgesChange={updateEdges}
              onNodeOpen={setSelectedNodeId}
              onNodeDelete={removeNode}
              onClearSelection={() => setSelectedNodeId(null)}
            />
          )}
        </div>

        <div className="agent-flow-sidebar">
          {selectedNodeId &&
            (() => {
              const selected = flow.nodes.find((n) => n.id === selectedNodeId);
              if (!selected) return null;
              return (
                <NodeConfigDrawer
                  node={selected}
                  agents={agents}
                  onChange={updateNode}
                  onDelete={() => removeNode(selected.id)}
                  onCreateAgent={createAgentInline}
                  onDeleteAgent={deleteAgentInline}
                  onCreateRoleNode={(role) => createRoleNode(selected.id, role)}
                  onClose={() => setSelectedNodeId(null)}
                />
              );
            })()}

          <SupervisorPanel
            supervisor={flow.supervisor}
            agents={agents}
            onChange={(supervisor) => setFlow({ ...flow, supervisor })}
          />

          <ConnectionsPanel edges={flow.edges} nodes={flow.nodes} onChange={updateEdges} />
        </div>
      </div>

      {pendingProceed && (
        <UnsavedChangesModal
          onSave={() => void handleUnsavedSave()}
          onDiscard={handleUnsavedDiscard}
          onCancel={handleUnsavedCancel}
          saving={unsavedModalSaving}
          error={unsavedModalError}
        />
      )}
    </div>
  );
}
