import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  ConnectionMode,
  Handle,
  MarkerType,
  Position,
  BaseEdge,
  ConnectionLineType,
  NodeResizer,
  Panel,
  applyNodeChanges,
  getStraightPath,
  useInternalNode,
  type Connection,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LockClosedIcon, LockOpenIcon, PlusIcon, XMarkIcon } from "@heroicons/react/20/solid";
import type { WorkspaceAction, WorkspaceGraph, WorkspaceZone } from "../types.js";
import { useI18n } from "../i18n/index.js";
import {
  borderPoint,
  defaultPosition,
  isTrusted,
  pairAudit,
  pairHasTrust,
  pairsFromLinks,
  projectsInZone,
  rectFromDrag,
  ZONE_COLORS,
  type ProjectPair,
  type Rect,
} from "./workspacesGraph.js";

/**
 * Home window → Workspaces: every project as a node. Dragging from one project
 * to another links them both ways right away (agents can then *ask* to reach
 * each other — nothing is trusted). Clicking a line configures, per direction
 * and action, whether agents are asked or trusted. See
 * notes/features/workspaces-canvas.md; state lives in main/workspace.ts.
 */

type ProjectNodeData = { name: string; color: string | null; open: boolean; openTitle: string };

function ProjectNode({ data }: NodeProps<Node<ProjectNodeData>>) {
  return (
    <div className="ws-node" style={data.color ? { borderColor: data.color } : undefined}>
      <Handle type="target" position={Position.Top} className="ws-handle" />
      {data.open && <span className="ws-node-open" title={data.openTitle} />}
      <span className="ws-node-name">{data.name}</span>
      <Handle type="source" position={Position.Bottom} className="ws-handle" />
    </div>
  );
}

type ZoneNodeData = { zone: WorkspaceZone };

/** What a zone node asks the canvas to save — through context, so node data stays plain. */
const ZoneActions = createContext<{
  rename: (zone: WorkspaceZone, name: string) => void;
  resized: (zone: WorkspaceZone, rect: Rect) => void;
  toggleLock: (zone: WorkspaceZone) => void;
  placeholder: string;
  lockedTitle: string;
  unlockedTitle: string;
}>({ rename: () => {}, resized: () => {}, toggleLock: () => {}, placeholder: "", lockedTitle: "", unlockedTitle: "" });

/**
 * A named, colored rectangle behind the projects. Visual only. Only its title
 * bar and resize handles take the pointer (see .react-flow__node-zone in
 * styles.css), so lines and projects inside it stay clickable and the empty
 * area still pans the canvas.
 */
function ZoneNode({ data, selected }: NodeProps<Node<ZoneNodeData>>) {
  const { rename, resized, toggleLock, placeholder, lockedTitle, unlockedTitle } = useContext(ZoneActions);
  const { zone } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(zone.name);
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== zone.name) rename(zone, draft.trim());
  };
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={80}
        minHeight={80}
        color={zone.color}
        onResizeEnd={(_e, p) => resized(zone, { x: p.x, y: p.y, width: p.width, height: p.height })}
      />
      <div className="ws-zone" style={{ background: `${zone.color}1a`, borderColor: zone.color }}>
        <div
          className="ws-zone-title"
          style={{ color: zone.color, background: `${zone.color}26` }}
          onDoubleClick={() => {
            setDraft(zone.name);
            setEditing(true);
          }}
        >
          <button
            type="button"
            className="nodrag ws-zone-lock"
            title={zone.locked ? lockedTitle : unlockedTitle}
            aria-pressed={zone.locked}
            onClick={(e) => {
              e.stopPropagation();
              toggleLock(zone);
            }}
          >
            {zone.locked ? <LockClosedIcon className="hero-icon" /> : <LockOpenIcon className="hero-icon" />}
          </button>
          {editing ? (
            <input
              className="nodrag ws-zone-input"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <span className="ws-zone-name">{zone.name || placeholder}</span>
          )}
        </div>
      </div>
    </>
  );
}

const nodeTypes = { project: ProjectNode, zone: ZoneNode };

const ZONE_PREFIX = "zone:";
const FALLBACK_NODE = { width: 160, height: 40 };

function nodeRect(node: InternalNode): Rect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured.width ?? 0,
    height: node.measured.height ?? 0,
  };
}

/**
 * A straight line between the two nodes' borders, along the line joining their
 * centers — not from the fixed handles, which only exist to start a drag.
 * Wherever the nodes are, the line leaves each one on the side facing the other.
 */
function FloatingEdge({ id, source, target, markerEnd, style, label, labelBgPadding, labelBgBorderRadius }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const from = borderPoint(nodeRect(sourceNode), nodeRect(targetNode));
  const to = borderPoint(nodeRect(targetNode), nodeRect(sourceNode));
  const [path, labelX, labelY] = getStraightPath({ sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y });
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      interactionWidth={16}
    />
  );
}

const edgeTypes = { floating: FloatingEdge };

export function WorkspacesCanvas({ visible }: { visible: boolean }) {
  const { t } = useI18n();
  const [graph, setGraph] = useState<WorkspaceGraph | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const nodesRef = useRef<Node[]>([]);
  nodesRef.current = nodes;
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // A zone being dragged: where it and the projects inside it started.
  // "+ Zone" arms drawing: the next drag on the canvas becomes the zone (screen coords, relative to the canvas box).
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const carryRef = useRef<{ zoneId: string; start: { x: number; y: number }; members: Map<string, { x: number; y: number }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void window.yggdrasil.workspace
      .graph()
      .then(setGraph)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);
  useEffect(() => window.yggdrasil.workspace.onChanged(load), [load]);

  const run = useCallback((task: Promise<unknown>) => {
    task.then(() => setError(null)).catch((e) => setError((e instanceof Error ? e.message : String(e)).replace(/^.*?Error: /, "")));
  }, []);

  // Positions come from the saved layout; a node keeps its local position while
  // being dragged, and is only written back on drop.
  useEffect(() => {
    if (!graph) return;
    let unplaced = 0;
    // Zones first and below: they're drawn behind the projects.
    const zoneNodes: Node[] = graph.zones.map((zone) => ({
      id: ZONE_PREFIX + zone.id,
      type: "zone",
      position: { x: zone.x, y: zone.y },
      width: zone.width,
      height: zone.height,
      zIndex: -1,
      dragHandle: ".ws-zone-title",
      connectable: false,
      selected: zone.id === selectedZone,
      data: { zone },
    }));
    const projectNodes: Node[] = graph.projects.map((p) => ({
      id: p.id,
      type: "project",
      position: graph.layout[p.id] ?? defaultPosition(unplaced++, graph.layout),
      deletable: false,
      data: { name: p.name, color: p.color, open: p.open, openTitle: t("ws.openWindow") },
    }));
    setNodes([...zoneNodes, ...projectNodes]);
    // selectedZone is read once per reload on purpose — selection changes don't need a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, t]);

  const pairs = useMemo(() => (graph ? pairsFromLinks(graph.links) : []), [graph]);
  const edges = useMemo<Edge[]>(
    () =>
      pairs.map((pair) => {
        const both = pair.ab && pair.ba;
        // One-way: draw it in the direction that is actually linked.
        const [source, target] = both || pair.ab ? [pair.a, pair.b] : [pair.b, pair.a];
        const trusted = graph ? pairHasTrust(graph.trust, pair.a, pair.b) : false;
        return {
          id: pair.key,
          type: "floating",
          source,
          target,
          selected: pair.key === selected,
          className: `ws-edge${both ? "" : " ws-edge--oneway"}${trusted ? " ws-edge--trusted" : ""}`,
          markerEnd: both ? undefined : { type: MarkerType.ArrowClosed },
          label: trusted ? t("ws.trustedMark") : undefined,
          labelBgPadding: [6, 2] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
    [pairs, graph, selected, t],
  );

  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const zoneById = (id: string) => graph?.zones.find((z) => z.id === id) ?? null;

  const zoneActions = useMemo(
    () => ({
      rename: (zone: WorkspaceZone, name: string) => run(window.yggdrasil.workspace.saveZone({ ...zone, name })),
      resized: (zone: WorkspaceZone, rect: Rect) => run(window.yggdrasil.workspace.saveZone({ ...zone, ...rect })),
      toggleLock: (zone: WorkspaceZone) => run(window.yggdrasil.workspace.saveZone({ ...zone, locked: !zone.locked })),
      placeholder: t("ws.zone.unnamed"),
      lockedTitle: t("ws.zone.lockedTitle"),
      unlockedTitle: t("ws.zone.unlockedTitle"),
    }),
    [run, t],
  );

  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawing(false);
        setDraft(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing]);

  const local = (e: React.PointerEvent) => {
    const box = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  /** Ends a drawing drag: a big enough rectangle becomes a zone (locked by default); a click or a tiny drag cancels. */
  const finishDrawing = () => {
    const box = canvasRef.current?.getBoundingClientRect();
    const instance = instanceRef.current;
    const current = draft;
    setDraft(null);
    setDrawing(false);
    if (!current || !box || !instance) return;
    const a = instance.screenToFlowPosition({ x: box.left + current.from.x, y: box.top + current.from.y });
    const b = instance.screenToFlowPosition({ x: box.left + current.to.x, y: box.top + current.to.y });
    const rect = rectFromDrag(a, b);
    if (rect.width < 40 || rect.height < 40) return;
    const zone: WorkspaceZone = {
      id: crypto.randomUUID(),
      name: t("ws.zone.newName"),
      color: ZONE_COLORS[(graph?.zones.length ?? 0) % ZONE_COLORS.length]!,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      locked: true,
    };
    setSelected(null);
    setSelectedZone(zone.id);
    run(window.yggdrasil.workspace.saveZone(zone));
  };

  const onNodeDragStart = (_e: unknown, node: Node) => {
    carryRef.current = null;
    if (node.type !== "zone") return;
    const zone = (node.data as ZoneNodeData).zone;
    // Unlocked: only the zone moves.
    if (!zone.locked) return;
    const projects = nodesRef.current
      .filter((n) => n.type === "project")
      .map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: n.measured?.width ?? FALLBACK_NODE.width,
        height: n.measured?.height ?? FALLBACK_NODE.height,
      }));
    const inside = projectsInZone({ x: node.position.x, y: node.position.y, width: zone.width, height: zone.height }, projects);
    carryRef.current = {
      zoneId: zone.id,
      start: { ...node.position },
      members: new Map(projects.filter((p) => inside.includes(p.id)).map((p) => [p.id, { x: p.x, y: p.y }])),
    };
  };

  const onNodeDrag = (_e: unknown, node: Node) => {
    const carry = carryRef.current;
    if (node.type !== "zone" || !carry) return;
    const dx = node.position.x - carry.start.x;
    const dy = node.position.y - carry.start.y;
    setNodes((current) =>
      current.map((n) => {
        const from = carry.members.get(n.id);
        return from ? { ...n, position: { x: from.x + dx, y: from.y + dy } } : n;
      }),
    );
  };

  const onNodeDragStop = (_e: unknown, node: Node) => {
    if (node.type !== "zone") {
      run(window.yggdrasil.workspace.setPosition(node.id, node.position));
      return;
    }
    const carry = carryRef.current;
    carryRef.current = null;
    const zone = (node.data as ZoneNodeData).zone;
    const dx = node.position.x - (carry?.start.x ?? node.position.x);
    const dy = node.position.y - (carry?.start.y ?? node.position.y);
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [id, from] of carry?.members ?? []) positions[id] = { x: from.x + dx, y: from.y + dy };
    run(window.yggdrasil.workspace.saveZone({ ...zone, x: node.position.x, y: node.position.y }, positions));
  };

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && c.source !== c.target) run(window.yggdrasil.workspace.connect(c.source, c.target));
    },
    [run],
  );

  const disconnect = useCallback(
    (pair: ProjectPair) => {
      if (graph && pairHasTrust(graph.trust, pair.a, pair.b) && !window.confirm(t("ws.disconnectConfirm"))) return;
      setSelected(null);
      run(window.yggdrasil.workspace.disconnect(pair.a, pair.b));
    },
    [graph, run, t],
  );

  const selectedPair = pairs.find((p) => p.key === selected) ?? null;
  const editedZone = selectedZone ? zoneById(selectedZone) : null;
  const name = (id: string) => graph?.projects.find((p) => p.id === id)?.name ?? id;

  if (!graph) return <div className="ws-view">{error && <p className="error">{error}</p>}</div>;

  return (
    <div className="ws-view">
      <div className="ws-header">
        <h2>{t("ws.title")}</h2>
        <p className="muted">{t("ws.intro")}</p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="ws-body">
        <div className="agent-flow-canvas ws-canvas" ref={canvasRef}>
          <ZoneActions.Provider value={zoneActions}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionMode={ConnectionMode.Loose}
            connectionLineType={ConnectionLineType.Straight}
            onNodesChange={onNodesChange}
            onInit={(instance) => (instanceRef.current = instance)}
            elevateNodesOnSelect={false}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_e, node) => {
              if (node.type !== "zone") return;
              setSelected(null);
              setSelectedZone((node.data as ZoneNodeData).zone.id);
            }}
            onNodeDoubleClick={(_e, node) => {
              if (node.type === "project") run(window.yggdrasil.projects.open(node.id));
            }}
            onConnect={onConnect}
            onEdgeClick={(_e, edge) => {
              setSelectedZone(null);
              setSelected(edge.id);
            }}
            onPaneClick={() => {
              setSelected(null);
              setSelectedZone(null);
            }}
            deleteKeyCode={["Delete", "Backspace"]}
            onBeforeDelete={async ({ edges: doomed, nodes: doomedNodes }) => {
              // Lines and zones are removed through main, never locally (projects aren't deletable here).
              for (const node of doomedNodes) {
                if (node.type === "zone") {
                  setSelectedZone(null);
                  run(window.yggdrasil.workspace.deleteZone((node.data as ZoneNodeData).zone.id));
                }
              }
              for (const edge of doomed) {
                const pair = pairs.find((p) => p.key === edge.id);
                if (pair) disconnect(pair);
              }
              return false;
            }}
            colorMode="dark"
            fitView
            minZoom={0.2}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--ygg-border)" />
            <Controls showInteractive={false} />
            <Panel position="top-left" className="ws-toolbar">
              <button
                type="button"
                className={drawing ? "ws-tool--active" : undefined}
                aria-pressed={drawing}
                onClick={() => {
                  setDraft(null);
                  setDrawing((d) => !d);
                }}
                title={t("ws.zone.addTitle")}
              >
                <PlusIcon className="hero-icon" /> {t("ws.zone.add")}
              </button>
              {drawing && <span className="ws-tool-hint">{t("ws.zone.drawHint")}</span>}
            </Panel>
          </ReactFlow>
          </ZoneActions.Provider>
          {drawing && (
            <div
              className="ws-draw-layer"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                const p = local(e);
                setDraft({ from: p, to: p });
              }}
              onPointerMove={(e) => {
                if (draft) setDraft({ from: draft.from, to: local(e) });
              }}
              onPointerUp={finishDrawing}
              onPointerCancel={() => setDraft(null)}
            >
              {draft &&
                (() => {
                  const r = rectFromDrag(draft.from, draft.to);
                  const color = ZONE_COLORS[(graph?.zones.length ?? 0) % ZONE_COLORS.length]!;
                  return (
                    <div
                      className="ws-draw-preview"
                      style={{ left: r.x, top: r.y, width: r.width, height: r.height, borderColor: color, background: `${color}1a` }}
                    />
                  );
                })()}
            </div>
          )}
        </div>

        {editedZone && !selectedPair && (
          <aside className="ws-panel">
            <div className="ws-panel-head">
              <h3>{t("ws.zone.title")}</h3>
              <button type="button" className="icon-btn" aria-label={t("ws.close")} onClick={() => setSelectedZone(null)}>
                <XMarkIcon className="hero-icon" />
              </button>
            </div>
            <label>
              {t("ws.zone.name")}
              <input
                key={editedZone.id + editedZone.name}
                type="text"
                defaultValue={editedZone.name}
                onBlur={(e) => {
                  if (e.target.value.trim() !== editedZone.name) zoneActions.rename(editedZone, e.target.value.trim());
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
            <div>
              <span className="muted">{t("ws.zone.color")}</span>
              <div className="ws-swatches">
                {ZONE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`ws-swatch${color === editedZone.color ? " ws-swatch--active" : ""}`}
                    style={{ background: color }}
                    aria-label={color}
                    onClick={() => run(window.yggdrasil.workspace.saveZone({ ...editedZone, color }))}
                  />
                ))}
                <input
                  type="color"
                  className="ws-swatch-custom"
                  value={editedZone.color}
                  title={t("ws.zone.customColor")}
                  onChange={(e) => run(window.yggdrasil.workspace.saveZone({ ...editedZone, color: e.target.value }))}
                />
              </div>
            </div>
            <label className="settings-check">
              <input type="checkbox" checked={editedZone.locked} onChange={() => zoneActions.toggleLock(editedZone)} />
              {t("ws.zone.lock")}
            </label>
            <p className="muted">{t(editedZone.locked ? "ws.zone.lockedHelp" : "ws.zone.unlockedHelp")}</p>
            <p className="muted">{t("ws.zone.help")}</p>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setSelectedZone(null);
                run(window.yggdrasil.workspace.deleteZone(editedZone.id));
              }}
            >
              {t("ws.zone.delete")}
            </button>
          </aside>
        )}

        {selectedPair && (
          <aside className="ws-panel">
            <div className="ws-panel-head">
              <h3>
                {name(selectedPair.a)} ↔ {name(selectedPair.b)}
              </h3>
              <button type="button" className="icon-btn" aria-label={t("ws.close")} onClick={() => setSelected(null)}>
                <XMarkIcon className="hero-icon" />
              </button>
            </div>
            {(
              [
                [selectedPair.a, selectedPair.b, selectedPair.ab],
                [selectedPair.b, selectedPair.a, selectedPair.ba],
              ] as const
            ).map(([from, to, linked]) => (
              <div key={`${from}>${to}`} className="ws-direction">
                <h4>
                  {name(from)} → {name(to)}
                </h4>
                {linked ? (
                  (["read", "write"] as WorkspaceAction[]).map((action) => {
                    const trusted = isTrusted(graph.trust, from, to, action);
                    return (
                      <div key={action}>
                        <label>
                          {t(action === "read" ? "ws.read" : "ws.write")}
                          <select
                            value={trusted ? "trust" : "ask"}
                            onChange={(e) =>
                              run(window.yggdrasil.workspace.setTrust(from, to, action, e.target.value === "trust"))
                            }
                          >
                            <option value="ask">{t("ws.ask")}</option>
                            <option value="trust">{t("ws.trust")}</option>
                          </select>
                        </label>
                        {action === "write" && trusted && (
                          <p className="ws-warning">{t("ws.writeTrustWarning", { from: name(from), to: name(to) })}</p>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="muted">{t("ws.notLinked")}</p>
                )}
              </div>
            ))}
            {!(selectedPair.ab && selectedPair.ba) && (
              <button type="button" onClick={() => run(window.yggdrasil.workspace.connect(selectedPair.a, selectedPair.b))}>
                {t("ws.connectBoth")}
              </button>
            )}
            <button type="button" className="danger" onClick={() => disconnect(selectedPair)}>
              {t("ws.disconnect")}
            </button>

            <h4>{t("ws.recent")}</h4>
            {(() => {
              const entries = pairAudit(graph.audit, name(selectedPair.a), name(selectedPair.b));
              if (entries.length === 0) return <p className="muted">{t("ws.noActivity")}</p>;
              return (
                <ul className="ws-audit">
                  {entries.map((e) => (
                    <li key={`${e.at}-${e.from}-${e.pane}`}>
                      <span>
                        {e.from} → {e.to} · {e.pane} · {t(e.action === "read" ? "ws.read" : "ws.write")}
                      </span>
                      <span className="muted">
                        {t(`ws.via_${e.via}` as const)} · {new Date(e.at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </aside>
        )}
      </div>
    </div>
  );
}
