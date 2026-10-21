import { useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { EdgeHandle, WfEdge, WfNode } from "./types.js";
import { WorkflowFlowNode, type WorkflowFlowNodeData } from "./WorkflowFlowNode.js";

const nodeTypes = { workflowNode: WorkflowFlowNode };

type Props = {
  nodes: WfNode[];
  edges: WfEdge[];
  selectedNodeId: string | null;
  runningNodeIds?: Set<string>;
  nodeStatus?: Record<string, "succeeded" | "failed" | "skipped">;
  onNodesChange: (nodes: WfNode[]) => void;
  onEdgesChange: (edges: WfEdge[]) => void;
  onNodeOpen: (id: string) => void;
  onNodeDelete: (id: string) => void;
  onClearSelection: () => void;
};

export function WorkflowCanvas({
  nodes,
  edges,
  selectedNodeId,
  runningNodeIds,
  nodeStatus,
  onNodesChange,
  onEdgesChange,
  onNodeOpen,
  onNodeDelete,
  onClearSelection,
}: Props) {
  // Without this cache, rfNodes is rebuilt fresh from domain data every
  // render, throwing away the `measured` dimensions react-flow's own
  // ResizeObserver just reported — and a node with no `measured` renders
  // permanently `visibility: hidden` (its own gate for "have I been
  // measured yet"), which never gets a chance to resolve. Same fix as
  // agentFlow/AgentFlowCanvas.tsx's measuredRef.
  const measuredRef = useRef(new Map<string, { width: number; height: number }>());

  const rfNodes: Node<WorkflowFlowNodeData>[] = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: "workflowNode",
        position: node.position,
        selected: node.id === selectedNodeId,
        measured: measuredRef.current.get(node.id),
        data: {
          node,
          running: runningNodeIds?.has(node.id) ?? false,
          status: nodeStatus?.[node.id],
          onOpen: () => onNodeOpen(node.id),
          onDelete: () => onNodeDelete(node.id),
        },
      })),
    [nodes, selectedNodeId, runningNodeIds, nodeStatus, onNodeOpen, onNodeDelete],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        sourceHandle: edge.fromHandle,
        targetHandle: "in",
        type: "smoothstep",
        pathOptions: { borderRadius: 6, offset: 24 },
        label: edge.fromHandle === "out" ? undefined : edge.fromHandle,
      })),
    [edges],
  );

  const toWfEdges = useCallback(
    (next: Edge[]): WfEdge[] =>
      next
        .filter((e) => e.source && e.target)
        .map((e) => ({ id: e.id, from: e.source, fromHandle: (e.sourceHandle ?? "out") as EdgeHandle, to: e.target })),
    [],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<WorkflowFlowNodeData>>[]) => {
      const next = applyNodeChanges(changes, rfNodes);
      for (const n of next) {
        if (n.measured?.width !== undefined && n.measured.height !== undefined) {
          measuredRef.current.set(n.id, { width: n.measured.width, height: n.measured.height });
        }
      }
      onNodesChange(next.map((n) => ({ ...n.data.node, position: n.position })));
    },
    [rfNodes, onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => onEdgesChange(toWfEdges(applyEdgeChanges(changes, rfEdges))),
    [rfEdges, onEdgesChange, toWfEdges],
  );

  const handleConnect = useCallback(
    (connection: Connection) => onEdgesChange(toWfEdges(addEdge(connection, rfEdges))),
    [rfEdges, onEdgesChange, toWfEdges],
  );

  return (
    <div className="workflow-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        connectionLineType={ConnectionLineType.SmoothStep}
        onPaneClick={onClearSelection}
        colorMode="dark"
        fitView
        minZoom={0.2}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--ygg-border)" />
        <Controls />
      </ReactFlow>
    </div>
  );
}
