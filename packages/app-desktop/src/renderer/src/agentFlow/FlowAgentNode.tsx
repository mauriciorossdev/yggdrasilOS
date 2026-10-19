import { Handle, Position, type NodeProps } from "@xyflow/react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import type { AgentFlowNode } from "../types.js";

export type FlowAgentNodeData = {
  node: AgentFlowNode;
  /** True while this node has a live turn in progress during a "Run Flow" run — see useAgentFlowRunEvents. */
  running?: boolean;
  onOpen: () => void;
  onDelete: () => void;
};

const HARNESS_LABEL: Record<AgentFlowNode["harness"]["type"], string> = {
  yggdrasil: "yggdrasil",
  claude: "claude",
  antigravity: "antigravity",
  omp: "omp",
  copilot: "copilot",
};

// Deliberately compact — full harness config (system prompt, model, effort,
// addDirs, ...) lives in NodeConfigDrawer, opened by clicking the box. A
// flow with several connected agents stays readable this way instead of
// each box being a full-height form.
export function FlowAgentNode({ data, selected }: NodeProps & { data: FlowAgentNodeData }) {
  const { node, running, onOpen, onDelete } = data;

  return (
    <div className={`flow-node-compact${selected ? " selected" : ""}${running ? " running" : ""}`} onClick={onOpen}>
      {/* One source+target pair per side (not just left/right) — lets a
          connection leave/enter whichever side actually faces the other
          node instead of always routing through the sides fixed here,
          which loops badly once siblings stack vertically. AgentFlowCanvas
          picks which pair to actually use per edge, live, off each node's
          real position — see its pickHandles. */}
      <Handle type="target" position={Position.Top} id="top-target" />
      <Handle type="source" position={Position.Top} id="top-source" />
      <Handle type="target" position={Position.Right} id="right-target" />
      <Handle type="source" position={Position.Right} id="right-source" />
      <Handle type="target" position={Position.Bottom} id="bottom-target" />
      <Handle type="source" position={Position.Bottom} id="bottom-source" />
      <Handle type="target" position={Position.Left} id="left-target" />
      <Handle type="source" position={Position.Left} id="left-source" />

      <div className="flow-node-compact-row">
        <span className={`flow-node-compact-badge harness-${node.harness.type}`}>
          {HARNESS_LABEL[node.harness.type]}
        </span>
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
      {node.harness.type === "yggdrasil" && (
        <div className="flow-node-compact-sub">{node.harness.agentId || "(no agent)"}</div>
      )}
      {node.communication && <div className="flow-node-compact-sub">{node.communication}</div>}
    </div>
  );
}
