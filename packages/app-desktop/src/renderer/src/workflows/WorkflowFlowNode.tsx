import { Handle, Position, type NodeProps } from "@xyflow/react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { handlesForNode, type WfNode } from "./types.js";

export type WorkflowFlowNodeData = {
  node: WfNode;
  /** True while this node has a live turn in this run — see WorkflowsView's run-event subscription. */
  running?: boolean;
  status?: "succeeded" | "failed" | "skipped";
  onOpen: () => void;
  onDelete: () => void;
};

// One target handle (top) — incoming edges never branch, only outgoing ones
// do (WfEdge.fromHandle) — plus one source handle per handle the node
// exposes (handlesForNode), spread evenly along the bottom so `if`'s
// true/false (or `switch`'s per-case handles) show as separate drag points.
export function WorkflowFlowNode({ data, selected }: NodeProps & { data: WorkflowFlowNodeData }) {
  const { node, running, status, onOpen, onDelete } = data;
  const handles = handlesForNode(node);

  return (
    <div className={`flow-node-compact workflow-node${selected ? " selected" : ""}${running ? " running" : ""}${status ? ` workflow-node-${status}` : ""}`} onClick={onOpen}>
      <Handle type="target" position={Position.Top} id="in" />

      <div className="flow-node-compact-row">
        <span className="flow-node-compact-badge">{node.type}</span>
        {running && <span className="flow-node-running-dot" title="Running" />}
        <button
          type="button"
          className="icon-btn nodrag"
          title="Remove node"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <XMarkIcon className="hero-icon" />
        </button>
      </div>
      <div className="flow-node-compact-name">{node.name || "Untitled"}</div>

      <div className="workflow-node-handles">
        {handles.map((h, i) => (
          <div key={h} className="workflow-node-handle-label" style={{ left: `${((i + 1) / (handles.length + 1)) * 100}%` }}>
            {h}
            <Handle type="source" position={Position.Bottom} id={h} style={{ left: `${((i + 1) / (handles.length + 1)) * 100}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
