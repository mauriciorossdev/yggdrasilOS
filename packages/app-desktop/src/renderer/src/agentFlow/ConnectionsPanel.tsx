import { useState } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import type { AgentFlowEdge, AgentFlowNode } from "../types.js";

type Props = {
  edges: AgentFlowEdge[];
  nodes: AgentFlowNode[];
  onChange: (edges: AgentFlowEdge[]) => void;
};

/**
 * List-based alternative to drawing edges on the canvas — same underlying
 * AgentFlowEdge data AgentFlowCanvas's drag-to-connect handles write. For
 * yggdrasil-to-yggdrasil edges, "Run Flow" (AgentFlowView) turns these into
 * a real invoke_agent allowlist (buildAgentFlowEdgeMap); edges touching a
 * claude/antigravity node stay display-only.
 */
export function ConnectionsPanel({ edges, nodes, onChange }: Props) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");

  const nameOf = (id: string) => nodes.find((n) => n.id === id)?.name ?? id;

  const add = () => {
    if (!from || !to || from === to) return;
    onChange([...edges, { id: crypto.randomUUID(), from, to, label: label.trim() || undefined }]);
    setFrom("");
    setTo("");
    setLabel("");
  };

  return (
    <div className="flow-connections">
      <h3>Connections</h3>
      <p className="muted flow-supervisor-note">
        Yggdrasil-to-yggdrasil edges scope "Run Flow" delegation; claude/antigravity edges are display-only.
      </p>
      <ul className="flow-connections-list">
        {edges.map((edge) => (
          <li key={edge.id} className="flow-connection-row">
            <span>
              {nameOf(edge.from)} → {nameOf(edge.to)}
              {edge.label ? ` (${edge.label})` : ""}
            </span>
            <button type="button" className="icon-btn" onClick={() => onChange(edges.filter((e) => e.id !== edge.id))}>
              <XMarkIcon className="hero-icon" />
            </button>
          </li>
        ))}
        {edges.length === 0 && <li className="muted">No connections</li>}
      </ul>
      {nodes.length >= 2 && (
        <div className="flow-connection-form">
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">from…</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">to…</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label (optional)" />
          <button type="button" onClick={add} disabled={!from || !to || from === to}>
            + Add
          </button>
        </div>
      )}
    </div>
  );
}
