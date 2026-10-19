import { useCallback, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { WorkflowCanvas } from "./WorkflowCanvas.js";
import { NodeConfigDrawer } from "./NodeConfigDrawer.js";
import { TriggersPanel } from "./TriggersPanel.js";
import { RunHistoryPanel } from "./RunHistoryPanel.js";
import { GrantDialog } from "./GrantDialog.js";
import { useWorkflowRunEvents } from "./useWorkflowRunEvents.js";
import { DEFAULT_SETTINGS, type NodeTypeInfo, type WfEdge, type WfNode, type Workflow, type WorkflowSummary } from "./types.js";

const GRID_COLS = 3;
const GRID_STEP_X = 260;
const GRID_STEP_Y = 200;

function newWorkflow(): Workflow {
  return {
    id: crypto.randomUUID(),
    name: "New workflow",
    version: 1,
    enabled: true,
    triggers: [{ id: crypto.randomUUID(), type: "manual" }],
    nodes: [],
    edges: [],
    settings: DEFAULT_SETTINGS,
  };
}

function defaultParamsFor(type: string): Record<string, unknown> {
  switch (type) {
    case "if":
      return { condition: { op: "eq", left: "", right: "" } };
    case "set":
      return { name: "", value: "" };
    case "delay":
      return { ms: 1000 };
    case "switch":
      return { cases: [] };
    case "http.request":
      return { url: "", method: "GET" };
    case "agent.ask":
      return { prompt: "", provider: "claude" };
    case "loop":
      return { items: [], resultNodeId: undefined };
    case "phone.tool":
      return { deviceId: "", tool: "" };
    default:
      return {};
  }
}

function newNode(type: string, index: number): WfNode {
  return {
    id: crypto.randomUUID(),
    type,
    name: type,
    position: { x: (index % GRID_COLS) * GRID_STEP_X, y: Math.floor(index / GRID_COLS) * GRID_STEP_Y },
    params: defaultParamsFor(type),
  };
}

function snapshot(workflow: Workflow | null): string | null {
  return workflow ? JSON.stringify(workflow) : null;
}

/**
 * Owning container for the Workflows tab — modeled on agentFlow/AgentFlowView.tsx's
 * shape (holds all state, wires Canvas + Drawer + panels together), but all
 * persistence goes through the real gateway RPC (useGateway().call) since
 * workflows.* is a plugin-registered method, not Electron IPC like
 * window.yggdrasil.agentFlow — see notes/automation/workflows-design.md §8.1.
 */
export function WorkflowsView() {
  const { call, onEvent } = useGateway();

  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [nodeTypes, setNodeTypes] = useState<NodeTypeInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // null = no sidebar at all, so the canvas gets the full width by default —
  // only opens when the user actually asks for it (click a node, or the
  // Triggers/History toolbar buttons).
  const [sidebarTab, setSidebarTab] = useState<"node" | "triggers" | "history" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showGrantDialog, setShowGrantDialog] = useState(false);
  const [addNodeType, setAddNodeType] = useState("");

  const runState = useWorkflowRunEvents(onEvent, selectedId);

  const refreshList = useCallback(async () => {
    try {
      const result = await call<{ workflows: WorkflowSummary[] }>("workflows.list");
      setWorkflows(result.workflows);
      return result.workflows;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }, [call]);

  useEffect(() => {
    void refreshList();
    void call<{ nodeTypes: NodeTypeInfo[] }>("workflows.nodeTypes").then((r) => setNodeTypes(r.nodeTypes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the list (grant status, enabled, last-run info) whenever a run
  // for the selected workflow just finished, so the badge in the picker and
  // this workflow's own state stay in sync without a manual reload.
  useEffect(() => {
    if (runState.historyRefreshToken > 0) void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runState.historyRefreshToken]);

  const selectWorkflow = (id: string) => {
    const summary = workflows?.find((s) => s.workflow.id === id);
    if (!summary) return;
    setSelectedId(id);
    setDraft(structuredClone(summary.workflow));
    setSavedSnapshot(snapshot(summary.workflow));
    setSelectedNodeId(null);
    setSidebarTab(null);
    setError(null);
    setInfo(null);
  };

  const startNewWorkflow = () => {
    const wf = newWorkflow();
    setSelectedId(wf.id);
    setDraft(wf);
    setSavedSnapshot(null); // never saved — dirty by definition until Save
    setSelectedNodeId(null);
    setSidebarTab("triggers"); // a brand-new workflow only has an implicit manual trigger — worth surfacing right away
    setError(null);
    setInfo(null);
  };

  const dirty = draft !== null && snapshot(draft) !== savedSnapshot;
  const selectedSummary = workflows?.find((s) => s.workflow.id === selectedId);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await call("workflows.save", { workflow: draft });
      setSavedSnapshot(snapshot(draft));
      await refreshList();
      setInfo("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    if (!draft) return;
    setError(null);
    setInfo(null);
    try {
      const result = await call<{ run?: { id: string }; skipped?: boolean; reason?: string }>("workflows.run", { id: draft.id });
      if (result.reason === "grant_required") {
        setShowGrantDialog(true);
        return;
      }
      if (result.reason === "automation_paused") {
        setError('Automation is paused (kill switch) — turn it off in Settings → Automation.');
        return;
      }
      if (result.reason === "concurrency_skip") {
        setInfo("A run is already in flight for this workflow — this trigger was skipped.");
        return;
      }
      setInfo("Run started.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const cancelRun = async (runId: string) => {
    await call("workflows.cancel", { runId });
  };

  const deleteWorkflow = async () => {
    if (!draft) return;
    if (!window.confirm(`Delete "${draft.name}"? This also removes its grant and can't be undone.`)) return;
    await call("workflows.delete", { id: draft.id });
    setSelectedId(null);
    setDraft(null);
    setSavedSnapshot(null);
    await refreshList();
  };

  const toggleEnabled = async () => {
    if (!draft) return;
    const enabled = !draft.enabled;
    setDraft({ ...draft, enabled });
    if (savedSnapshot !== null) {
      await call("workflows.setEnabled", { id: draft.id, enabled });
      await refreshList();
    }
  };

  const addNode = () => {
    if (!draft || !addNodeType) return;
    const node = newNode(addNodeType, draft.nodes.length);
    setDraft({ ...draft, nodes: [...draft.nodes, node] });
    setSelectedNodeId(node.id);
    setSidebarTab("node");
  };

  const selectedNode = draft?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const onNodesChange = useCallback(
    (nodes: WfNode[]) => setDraft((d) => (d ? { ...d, nodes } : d)),
    [],
  );
  const onEdgesChange = useCallback(
    (edges: WfEdge[]) => setDraft((d) => (d ? { ...d, edges } : d)),
    [],
  );
  const onNodeOpen = useCallback((id: string) => {
    setSelectedNodeId(id);
    setSidebarTab("node");
  }, []);
  const onNodeDelete = useCallback((id: string) => {
    setDraft((d) => (d ? { ...d, nodes: d.nodes.filter((n) => n.id !== id), edges: d.edges.filter((e) => e.from !== id && e.to !== id) } : d));
    setSelectedNodeId((cur) => (cur === id ? null : cur));
  }, []);

  const grantBadge = (status: WorkflowSummary["grantStatus"]) => {
    if (status === "not_required") return null;
    return <span className={`workflow-grant-badge workflow-grant-${status}`}>{status}</span>;
  };

  return (
    <div className="agent-flow-view workflow-view">
      <div className="agent-flow-toolbar">
        <select value={selectedId ?? ""} onChange={(e) => (e.target.value ? selectWorkflow(e.target.value) : undefined)}>
          <option value="" disabled>
            Select a workflow…
          </option>
          {workflows?.map((s) => (
            <option key={s.workflow.id} value={s.workflow.id}>
              {s.workflow.name} {s.workflow.enabled ? "" : "(disabled)"} {s.grantStatus !== "not_required" ? `[${s.grantStatus}]` : ""}
            </option>
          ))}
        </select>
        <button type="button" className="agent-flow-toolbar-btn" onClick={startNewWorkflow}>
          + New workflow
        </button>
        {draft && (
          <>
            <input
              className="workflow-name-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <button type="button" className="agent-flow-toolbar-btn" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="agent-flow-toolbar-btn" onClick={() => void run()} disabled={dirty || !!runState.liveRunId}>
              {runState.liveRunId ? "Running…" : "Run"}
            </button>
            {runState.liveRunId && (
              <button type="button" className="agent-flow-toolbar-btn" onClick={() => void cancelRun(runState.liveRunId!)}>
                Cancel run
              </button>
            )}
            <button type="button" className="agent-flow-toolbar-btn" onClick={() => void toggleEnabled()}>
              {draft.enabled ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              className={`agent-flow-toolbar-btn${sidebarTab === "triggers" ? " active" : ""}`}
              onClick={() => {
                setSelectedNodeId(null);
                setSidebarTab((t) => (t === "triggers" ? null : "triggers"));
              }}
            >
              Triggers
            </button>
            <button
              type="button"
              className={`agent-flow-toolbar-btn${sidebarTab === "history" ? " active" : ""}`}
              onClick={() => {
                setSelectedNodeId(null);
                setSidebarTab((t) => (t === "history" ? null : "history"));
              }}
            >
              History
            </button>
            <button type="button" className="agent-flow-toolbar-btn danger" onClick={() => void deleteWorkflow()}>
              Delete
            </button>
            {selectedSummary && grantBadge(selectedSummary.grantStatus)}
          </>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {info && !error && <p className="muted">{info}</p>}

      {!draft && <p className="muted">Select a workflow, or create a new one.</p>}

      {draft && (
        <div className="agent-flow-body">
          <div className="workflow-main-column">
            <div className="workflow-add-node">
              <select value={addNodeType} onChange={(e) => setAddNodeType(e.target.value)}>
                <option value="">+ Add node…</option>
                {nodeTypes.map((nt) => (
                  <option key={nt.type} value={nt.type}>
                    {nt.type} — {nt.description}
                  </option>
                ))}
              </select>
              <button type="button" onClick={addNode} disabled={!addNodeType}>
                Add
              </button>
            </div>
            <div className="agent-flow-canvas-area">
              {draft.nodes.length === 0 ? (
                <div className="agent-flow-canvas-empty muted">No nodes yet — add one above.</div>
              ) : (
                <WorkflowCanvas
                  nodes={draft.nodes}
                  edges={draft.edges}
                  selectedNodeId={selectedNodeId}
                  runningNodeIds={runState.runningNodeIds}
                  nodeStatus={runState.nodeStatus}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onNodeOpen={onNodeOpen}
                  onNodeDelete={onNodeDelete}
                  onClearSelection={() => setSelectedNodeId(null)}
                />
              )}
            </div>
          </div>

          {sidebarTab === "node" && selectedNode && (
            <NodeConfigDrawer
              node={selectedNode}
              allNodes={draft.nodes}
              onChange={(node) => setDraft({ ...draft, nodes: draft.nodes.map((n) => (n.id === node.id ? node : n)) })}
              onDelete={() => onNodeDelete(selectedNode.id)}
              onClose={() => {
                setSelectedNodeId(null);
                setSidebarTab(null);
              }}
            />
          )}
          {sidebarTab === "triggers" && (
            <TriggersPanel
              triggers={draft.triggers}
              onChange={(triggers) => setDraft({ ...draft, triggers })}
              allowRemoteTrigger={draft.settings.allowRemoteTrigger}
            />
          )}
          {sidebarTab === "history" && <RunHistoryPanel workflowId={draft.id} refreshToken={runState.historyRefreshToken} onCancel={(id) => void cancelRun(id)} />}
        </div>
      )}

      {showGrantDialog && draft && (
        <GrantDialog
          workflowId={draft.id}
          onGranted={async () => {
            setShowGrantDialog(false);
            await refreshList();
            await run();
          }}
          onCancel={() => setShowGrantDialog(false)}
        />
      )}
    </div>
  );
}
