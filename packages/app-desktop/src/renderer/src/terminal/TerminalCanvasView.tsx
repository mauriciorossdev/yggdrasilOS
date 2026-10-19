import { useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { newLeaf, type LeafPane, type PaneAction } from "./paneTree.js";
import type { TerminalRegistry } from "./terminalRegistry.js";
import { TerminalFlowNode, type TerminalFlowNodeData } from "./TerminalFlowNode.js";
import { useTerminalCanvasEdges } from "./useTerminalCanvasEdges.js";

const nodeTypes = { terminal: TerminalFlowNode };

// Matches .terminal-flow-node's fixed CSS size (styles.css) — only used
// before react-flow's own ResizeObserver reports real `measured`
// dimensions for a node (see measuredRef below), same pattern as
// AgentFlowCanvas.tsx's DEFAULT_NODE_WIDTH/HEIGHT.
const DEFAULT_NODE_WIDTH = 640;
const DEFAULT_NODE_HEIGHT = 420;

// Cascade placement for a leaf that's never had its canvas node dragged —
// only counts among leaves missing a position, so already-placed nodes
// never jump when a new pane appears (see defaultCanvasPosition below).
const CASCADE_COLS = 3;
const CASCADE_STEP_X = 720;
const CASCADE_STEP_Y = 480;

function defaultCanvasPosition(index: number): { x: number; y: number } {
  return { x: (index % CASCADE_COLS) * CASCADE_STEP_X, y: Math.floor(index / CASCADE_COLS) * CASCADE_STEP_Y };
}

function nodeCenter(
  position: { x: number; y: number },
  measured: { width: number; height: number } | undefined,
): { x: number; y: number } {
  const width = measured?.width ?? DEFAULT_NODE_WIDTH;
  const height = measured?.height ?? DEFAULT_NODE_HEIGHT;
  return { x: position.x + width / 2, y: position.y + height / 2 };
}

// Same smart-handle-side logic as AgentFlowCanvas.tsx's pickHandles,
// duplicated rather than imported (different domain, own CSS/behavior
// lifecycle) — whichever axis separates the two nodes more decides
// top/bottom vs left/right, and the sign decides which side of that axis.
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
  /** Already filtered for minimized panes by TerminalContainer.tsx. */
  leaves: LeafPane[];
  activePaneId: string | null;
  registry: TerminalRegistry;
  projectPath: string | null;
  dispatch: React.Dispatch<PaneAction>;
  onMinimize: (id: string) => void;
  mobileFocusedIds: Set<string>;
};

/**
 * Free-form "pizarra" view of the same open terminals TerminalContainer's
 * grid mode renders — built on @xyflow/react (react-flow), the same library
 * already powering the Agent Flow tab's node canvas (AgentFlowCanvas.tsx),
 * so pan/zoom/node-drag come from the library with no hand-rolled transform
 * math. Each node hosts the real TerminalPane (same registry, same leaf id
 * — see TerminalFlowNode.tsx), not a re-rendering of terminal content, so
 * toggling Grid<->Canvas never touches any pty or scrollback.
 */
export function TerminalCanvasView({
  leaves,
  activePaneId,
  registry,
  projectPath,
  dispatch,
  onMinimize,
  mobileFocusedIds,
}: Props) {
  // AgentFlowCanvas.tsx's own measuredRef comment applies verbatim here:
  // rfNodes is rebuilt fresh from `leaves` every render, so a node's real
  // react-flow-measured size (reported via a "dimensions" NodeChange) would
  // otherwise be thrown away on the very next render.
  const measuredRef = useRef(new Map<string, { width: number; height: number }>());

  const rfNodes: Node<TerminalFlowNodeData>[] = useMemo(() => {
    let cascadeIndex = 0;
    return leaves.map((leaf) => {
      const data: TerminalFlowNodeData = {
        leaf,
        registry,
        projectPath,
        active: leaf.id === activePaneId,
        mobileFocused: mobileFocusedIds.has(leaf.id),
        onFocus: () => dispatch({ type: "FOCUS", id: leaf.id }),
        onRename: (title: string) => dispatch({ type: "RENAME", id: leaf.id, title }),
        onSplit: (direction: "row" | "column") =>
          dispatch({ type: "SPLIT", targetId: leaf.id, direction, newLeaf: newLeaf(leaf.cwd, "Terminal") }),
        onClose: () => dispatch({ type: "CLOSE", id: leaf.id }),
        onMinimize: () => onMinimize(leaf.id),
        onDelegated: (targetId: string) => dispatch({ type: "FOCUS", id: targetId }),
        dispatch,
      };
      const position = leaf.canvasPosition ?? defaultCanvasPosition(cascadeIndex++);
      return {
        id: leaf.id,
        type: "terminal",
        position,
        dragHandle: ".terminal-pane-header",
        selected: leaf.id === activePaneId,
        measured: measuredRef.current.get(leaf.id),
        data,
      };
    });
  }, [leaves, activePaneId, registry, projectPath, mobileFocusedIds, dispatch, onMinimize]);

  const positionsById = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of rfNodes) map.set(node.id, node.position);
    return map;
  }, [rfNodes]);

  const { edges: canvasEdges, activeEdgeIds } = useTerminalCanvasEdges(leaves);

  const rfEdges: Edge[] = useMemo(
    () =>
      canvasEdges.map((edge) => {
        const fromPos = positionsById.get(edge.from);
        const toPos = positionsById.get(edge.to);
        let handles: { sourceHandle: string; targetHandle: string } | undefined;
        if (fromPos && toPos) {
          const a = nodeCenter(fromPos, measuredRef.current.get(edge.from));
          const b = nodeCenter(toPos, measuredRef.current.get(edge.to));
          handles = pickHandles(b.x - a.x, b.y - a.y);
        }
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          sourceHandle: handles?.sourceHandle,
          targetHandle: handles?.targetHandle,
          animated: activeEdgeIds.has(edge.id),
        };
      }),
    // positionsById gets a fresh identity on every rfNodes change (including
    // live drag updates), so this recomputes every drag frame too — an
    // edge's handle side stays "smart" as nodes move.
    [canvasEdges, positionsById, activeEdgeIds],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<TerminalFlowNodeData>>[]) => {
      const next = applyNodeChanges(changes, rfNodes);
      const positions: Array<{ id: string; position: { x: number; y: number } }> = [];
      for (const n of next) {
        if (n.measured?.width !== undefined && n.measured.height !== undefined) {
          measuredRef.current.set(n.id, { width: n.measured.width, height: n.measured.height });
        }
        positions.push({ id: n.id, position: n.position });
      }
      if (positions.length > 0) dispatch({ type: "SET_CANVAS_POSITIONS", positions });
    },
    [rfNodes, dispatch],
  );

  return (
    <div className="terminal-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        deleteKeyCode={null}
        nodesFocusable={false}
        selectNodesOnDrag={false}
        zoomOnScroll={false}
        colorMode="dark"
        fitView
        minZoom={0.15}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#2a2d33" />
        <Controls />
      </ReactFlow>
    </div>
  );
}
