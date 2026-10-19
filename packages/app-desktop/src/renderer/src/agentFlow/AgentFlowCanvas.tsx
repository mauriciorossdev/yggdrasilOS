import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AgentFlowEdge, AgentFlowNode } from "../types.js";
import { FlowAgentNode, type FlowAgentNodeData } from "./FlowAgentNode.js";

const nodeTypes = { agent: FlowAgentNode };

// Matches .flow-node-compact's fixed width and a typical unmeasured-node
// height (styles.css) — only used before react-flow's own ResizeObserver
// reports real `measured` dimensions for a node (see measuredRef below),
// which happens within the first render or two anyway.
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 70;

function nodeCenter(node: AgentFlowNode, measured: { width: number; height: number } | undefined): { x: number; y: number } {
  const width = measured?.width ?? DEFAULT_NODE_WIDTH;
  const height = measured?.height ?? DEFAULT_NODE_HEIGHT;
  return { x: node.position.x + width / 2, y: node.position.y + height / 2 };
}

// Picks which of FlowAgentNode's 4 handle pairs an edge should actually use,
// off the two nodes' real on-canvas positions — whichever axis (horizontal
// vs vertical) separates them more decides top/bottom vs left/right, and
// the sign decides which side of that axis. Always left/right before this
// (FlowAgentNode.tsx used to have exactly one target+one source handle),
// so a child stacked mostly *below* its parent still routed through the
// side handles and looped — this is what keeps the line short and direct
// instead.
function pickHandles(dx: number, dy: number): { sourceHandle: string; targetHandle: string } {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "right-source", targetHandle: "left-target" }
      : { sourceHandle: "left-source", targetHandle: "right-target" };
  }
  return dy >= 0
    ? { sourceHandle: "bottom-source", targetHandle: "top-target" }
    : { sourceHandle: "top-source", targetHandle: "bottom-target" };
}

type Props = {
  nodes: AgentFlowNode[];
  edges: AgentFlowEdge[];
  selectedNodeId: string | null;
  runningNodeIds?: Set<string>;
  /** Edge ids to briefly animate — a write_pane just fired between the two nodes they connect. See AgentFlowView.tsx's onCommunication. */
  activeEdgeIds?: Set<string>;
  onNodesChange: (nodes: AgentFlowNode[]) => void;
  onEdgesChange: (edges: AgentFlowEdge[]) => void;
  onNodeOpen: (id: string) => void;
  onNodeDelete: (id: string) => void;
  onClearSelection: () => void;
};

export function AgentFlowCanvas({
  nodes,
  edges,
  selectedNodeId,
  runningNodeIds,
  activeEdgeIds,
  onNodesChange,
  onEdgesChange,
  onNodeOpen,
  onNodeDelete,
  onClearSelection,
}: Props) {
  // AgentFlowNode (our domain model) carries no `measured`/width/height —
  // react-flow reports those via a "dimensions" NodeChange the first time
  // its ResizeObserver sees a node, but rfNodes is rebuilt fresh from domain
  // data every render, so that measurement would otherwise be thrown away
  // on the very next render and the node stays permanently
  // `visibility: hidden` (its own gate for "have I been measured yet").
  // Cache it here, keyed by node id, and reattach it below.
  const measuredRef = useRef(new Map<string, { width: number; height: number }>());

  const rfNodes: Node<FlowAgentNodeData>[] = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: "agent",
        position: node.position,
        selected: node.id === selectedNodeId,
        measured: measuredRef.current.get(node.id),
        data: {
          node,
          running: runningNodeIds?.has(node.id) ?? false,
          onOpen: () => onNodeOpen(node.id),
          onDelete: () => onNodeDelete(node.id),
        },
      })),
    [nodes, selectedNodeId, runningNodeIds, onNodeOpen, onNodeDelete],
  );

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((edge) => {
        const sourceNode = nodesById.get(edge.from);
        const targetNode = nodesById.get(edge.to);
        let handles: { sourceHandle: string; targetHandle: string } | undefined;
        if (sourceNode && targetNode) {
          const a = nodeCenter(sourceNode, measuredRef.current.get(sourceNode.id));
          const b = nodeCenter(targetNode, measuredRef.current.get(targetNode.id));
          handles = pickHandles(b.x - a.x, b.y - a.y);
        }
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          sourceHandle: handles?.sourceHandle,
          targetHandle: handles?.targetHandle,
          label: edge.label,
          // react-flow's own built-in moving-dashes treatment — see
          // .react-flow__edge.animated in styles.css for the color/width.
          animated: activeEdgeIds?.has(edge.id) ?? false,
        };
      }),
    // nodesById gets a fresh Map identity on every `nodes` change (including
    // live drag updates), so this recomputes on every drag frame too — an
    // edge's handle side stays "smart", not fixed the moment it was drawn.
    [edges, nodesById, activeEdgeIds],
  );

  // fitView only runs on mount — a node added after that (e.g. the 2nd/3rd
  // "+ Add Node" click) can land outside the current viewport at its grid
  // position and look like nothing happened. Also re-fit whenever the set of
  // node ids changes wholesale (opening a different team swaps every node in
  // one render, so a plain count check would miss a same-size swap) so an
  // opened team always lands centered instead of wherever the previous
  // flow's viewport happened to be.
  const instanceRef = useRef<ReactFlowInstance<Node<FlowAgentNodeData>, Edge> | null>(null);
  const prevIdsRef = useRef(new Set(nodes.map((n) => n.id)));
  useEffect(() => {
    const ids = new Set(nodes.map((n) => n.id));
    const prev = prevIdsRef.current;
    const changed = ids.size !== prev.size || [...ids].some((id) => !prev.has(id));
    if (changed) {
      instanceRef.current?.fitView({ padding: 0.3, duration: 300 });
    }
    prevIdsRef.current = ids;
  }, [nodes]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<FlowAgentNodeData>>[]) => {
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

  const toAgentFlowEdges = useCallback(
    (next: Edge[]): AgentFlowEdge[] =>
      next.map((e) => {
        const existing = edges.find((orig) => orig.id === e.id);
        return { id: e.id, from: e.source, to: e.target, label: existing?.label };
      }),
    [edges],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => onEdgesChange(toAgentFlowEdges(applyEdgeChanges(changes, rfEdges))),
    [rfEdges, onEdgesChange, toAgentFlowEdges],
  );

  const handleConnect = useCallback(
    (connection: Connection) => onEdgesChange(toAgentFlowEdges(addEdge(connection, rfEdges))),
    [rfEdges, onEdgesChange, toAgentFlowEdges],
  );

  return (
    <div className="agent-flow-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onPaneClick={onClearSelection}
        onInit={(instance) => (instanceRef.current = instance)}
        colorMode="dark"
        fitView
        minZoom={0.2}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#2a2d33" />
        <Controls />
        <MiniMap pannable zoomable style={{ background: "#191b20" }} maskColor="rgba(20,22,26,0.6)" />
      </ReactFlow>
    </div>
  );
}
