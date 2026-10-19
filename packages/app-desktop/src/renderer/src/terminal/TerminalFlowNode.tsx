import { Handle, Position, type NodeProps } from "@xyflow/react";
import { TerminalPane } from "./TerminalPane.js";
import type { LeafPane, PaneAction } from "./paneTree.js";
import type { TerminalRegistry } from "./terminalRegistry.js";

export type TerminalFlowNodeData = {
  leaf: LeafPane;
  registry: TerminalRegistry;
  projectPath: string | null;
  active: boolean;
  mobileFocused: boolean;
  onFocus: () => void;
  onRename: (title: string) => void;
  onSplit: (direction: "row" | "column") => void;
  onClose: () => void;
  onMinimize: () => void;
  onDelegated: (targetLeafId: string) => void;
  dispatch: React.Dispatch<PaneAction>;
};

/**
 * TerminalCanvasView's custom react-flow node type — wraps the exact same
 * TerminalPane used by the grid view (no separate terminal-rendering code
 * path) inside a "window" frame with connection handles on all 4 sides, so
 * a pulsed communication edge (useTerminalCanvasEdges.ts) can attach from
 * whichever side actually faces the other node — see AgentFlowCanvas.tsx's
 * pickHandles, which TerminalCanvasView duplicates for this same reason.
 *
 * `nodrag`/`nowheel` on the outer wrapper plus the node's own
 * `dragHandle: ".terminal-pane-header"` (set by TerminalCanvasView) keep
 * react-flow's pan/zoom/node-drag gestures from hijacking normal terminal
 * interaction (typing, text selection, scrollback-scroll) — only the
 * pane's header bar can start a node drag.
 */
export function TerminalFlowNode({ data }: NodeProps & { data: TerminalFlowNodeData }) {
  const d = data;
  return (
    <div className="terminal-flow-node nodrag nowheel">
      <Handle type="target" position={Position.Top} id="top-target" className="terminal-flow-node-handle" />
      <Handle type="source" position={Position.Top} id="top-source" className="terminal-flow-node-handle" />
      <Handle type="target" position={Position.Right} id="right-target" className="terminal-flow-node-handle" />
      <Handle type="source" position={Position.Right} id="right-source" className="terminal-flow-node-handle" />
      <Handle type="target" position={Position.Bottom} id="bottom-target" className="terminal-flow-node-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom-source" className="terminal-flow-node-handle" />
      <Handle type="target" position={Position.Left} id="left-target" className="terminal-flow-node-handle" />
      <Handle type="source" position={Position.Left} id="left-source" className="terminal-flow-node-handle" />
      <TerminalPane
        leaf={d.leaf}
        registry={d.registry}
        projectPath={d.projectPath}
        active={d.active}
        onFocus={d.onFocus}
        onRename={d.onRename}
        onSplit={d.onSplit}
        onClose={d.onClose}
        onMinimize={d.onMinimize}
        onDelegated={d.onDelegated}
        dispatch={d.dispatch}
        mobileFocused={d.mobileFocused}
        canvasMode
      />
    </div>
  );
}
