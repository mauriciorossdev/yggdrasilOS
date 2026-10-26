import { useState } from "react";
import { TrashIcon, XMarkIcon } from "@heroicons/react/20/solid";
import type { AgentFlowHarness, AgentFlowNode, AgentInfo } from "../types.js";
import { AgentTemplatePicker } from "./AgentTemplatePicker.js";
import { isCliVisible } from "../onboarding/harnessFilter.js";
import { useOnboarding } from "../onboarding/store.js";

type Props = {
  node: AgentFlowNode;
  agents: AgentInfo[];
  onChange: (node: AgentFlowNode) => void;
  onDelete: () => void;
  onCreateAgent: (id: string) => void;
  onDeleteAgent: (id: string) => void;
  onClose: () => void;
  /** Picking a role template in AgentTemplatePicker also drops a connected node for it onto the canvas. */
  onCreateRoleNode: (role: { label: string; prompt: string }) => void;
};

const EFFORT_5 = ["low", "medium", "high", "xhigh", "max"] as const;
const EFFORT_3 = ["low", "medium", "high"] as const;
const OMP_THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"] as const;
const OMP_APPROVAL_MODES = ["always-ask", "write", "yolo"] as const;

function harnessFor(type: AgentFlowHarness["type"]): AgentFlowHarness {
  switch (type) {
    case "yggdrasil":
      return { type: "yggdrasil", agentId: "" };
    case "claude":
      return { type: "claude" };
    case "antigravity":
      return { type: "antigravity" };
    case "omp":
      return { type: "omp" };
    case "copilot":
      return { type: "copilot" };
  }
}

/**
 * Slide-in panel for one node's full harness config — everything NodeCard
 * used to render inline in the flat list, now surfaced on demand instead of
 * living on the canvas box itself. Canvas nodes (FlowAgentNode) stay small
 * so a flow with several agents connected by edges stays legible; this is
 * where the actual editing happens, opened by clicking a node.
 */
export function NodeConfigDrawer({
  node,
  agents,
  onChange,
  onDelete,
  onCreateAgent,
  onDeleteAgent,
  onClose,
  onCreateRoleNode,
}: Props) {
  const [showNewAgent, setShowNewAgent] = useState(false);
  const { settings: onboardingSettings } = useOnboarding();
  // A node already using a filtered-out harness keeps it in the list so the select never shows a blank value.
  const harnessOption = (type: "claude" | "antigravity" | "omp" | "copilot") =>
    node.harness.type === type || isCliVisible(type, onboardingSettings);
  const [newAgentId, setNewAgentId] = useState("");

  const setHarness = (harness: AgentFlowHarness) => onChange({ ...node, harness });
  const addDirsValue = (dirs?: string[]) => (dirs ?? []).join(", ");
  const parseAddDirs = (v: string) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  return (
    <div className="node-config-drawer">
      <div className="node-config-drawer-header">
        <input
          className="flow-node-name"
          value={node.name}
          onChange={(e) => onChange({ ...node, name: e.target.value })}
          placeholder="Node name"
          autoFocus
        />
        <button type="button" className="icon-btn" onClick={onClose} title="Close">
          <XMarkIcon className="hero-icon" />
        </button>
      </div>

      <div className="node-config-drawer-body">
        <label>
          Harness
          <select
            value={node.harness.type}
            onChange={(e) => setHarness(harnessFor(e.target.value as AgentFlowHarness["type"]))}
          >
            <option value="yggdrasil">yggdrasil</option>
            {harnessOption("claude") && <option value="claude">claude</option>}
            {harnessOption("antigravity") && <option value="antigravity">antigravity</option>}
            {harnessOption("omp") && <option value="omp">omp</option>}
            {harnessOption("copilot") && <option value="copilot">copilot</option>}
          </select>
        </label>

        {node.harness.type === "yggdrasil" &&
          (() => {
            const ygg = node.harness as Extract<AgentFlowHarness, { type: "yggdrasil" }>;
            return (
              <>
                <label>
                  Agent
                  <div className="flow-node-agent-row">
                    <select value={ygg.agentId} onChange={(e) => setHarness({ type: "yggdrasil", agentId: e.target.value })}>
                      <option value="">(select an agent)</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label ?? a.id}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Delete agent"
                      disabled={!ygg.agentId}
                      onClick={() => onDeleteAgent(ygg.agentId)}
                    >
                      <TrashIcon className="hero-icon" />
                    </button>
                  </div>
                </label>
                {!showNewAgent ? (
                  <button type="button" className="link-btn" onClick={() => setShowNewAgent(true)}>
                    + New agent
                  </button>
                ) : (
                  <div className="flow-node-new-agent">
                    <input
                      value={newAgentId}
                      onChange={(e) => setNewAgentId(e.target.value)}
                      placeholder="New agent id"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const id = newAgentId.trim();
                        if (!id) return;
                        onCreateAgent(id);
                        setHarness({ type: "yggdrasil", agentId: id });
                        setNewAgentId("");
                        setShowNewAgent(false);
                      }}
                    >
                      Create
                    </button>
                    <button type="button" onClick={() => setShowNewAgent(false)}>
                      Cancel
                    </button>
                  </div>
                )}
              </>
            );
          })()}

        {node.harness.type === "claude" &&
          (() => {
            const claude = node.harness as Extract<AgentFlowHarness, { type: "claude" }>;
            return (
              <>
                <label>
                  Initial prompt
                  <textarea
                    value={claude.initialPrompt ?? ""}
                    onChange={(e) => setHarness({ ...claude, initialPrompt: e.target.value })}
                    rows={3}
                  />
                </label>
                <AgentTemplatePicker
                  value={claude.initialPrompt ?? ""}
                  onChange={(v) => setHarness({ ...claude, initialPrompt: v })}
                  onCreateRoleNode={onCreateRoleNode}
                />
                <label>
                  System prompt (appended)
                  <textarea
                    value={claude.systemPromptAppend ?? ""}
                    onChange={(e) => setHarness({ ...claude, systemPromptAppend: e.target.value })}
                    rows={3}
                  />
                </label>
                <label>
                  Model
                  <input
                    value={claude.model ?? ""}
                    onChange={(e) => setHarness({ ...claude, model: e.target.value || undefined })}
                    placeholder="(default)"
                  />
                </label>
                <label>
                  Effort
                  <select
                    value={claude.effort ?? ""}
                    onChange={(e) =>
                      setHarness({ ...claude, effort: (e.target.value || undefined) as typeof claude.effort })
                    }
                  >
                    <option value="">(default)</option>
                    {EFFORT_5.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Additional dirs (comma-separated)
                  <input
                    value={addDirsValue(claude.addDirs)}
                    onChange={(e) => setHarness({ ...claude, addDirs: parseAddDirs(e.target.value) })}
                  />
                </label>
                <label className="flow-node-checkbox">
                  <input
                    type="checkbox"
                    checked={claude.cloud ?? false}
                    onChange={(e) => setHarness({ ...claude, cloud: e.target.checked || undefined })}
                  />
                  Run in Claude Cloud (--cloud, instead of a local terminal pane)
                </label>
              </>
            );
          })()}

        {node.harness.type === "antigravity" &&
          (() => {
            const agy = node.harness as Extract<AgentFlowHarness, { type: "antigravity" }>;
            return (
              <>
                <label>
                  Initial prompt
                  <textarea
                    value={agy.initialPrompt ?? ""}
                    onChange={(e) => setHarness({ ...agy, initialPrompt: e.target.value })}
                    rows={3}
                  />
                </label>
                <AgentTemplatePicker
                  value={agy.initialPrompt ?? ""}
                  onChange={(v) => setHarness({ ...agy, initialPrompt: v })}
                  onCreateRoleNode={onCreateRoleNode}
                />
                <label>
                  Model
                  <input
                    value={agy.model ?? ""}
                    onChange={(e) => setHarness({ ...agy, model: e.target.value || undefined })}
                    placeholder="(default)"
                  />
                </label>
                <label>
                  Effort
                  <select
                    value={agy.effort ?? ""}
                    onChange={(e) => setHarness({ ...agy, effort: (e.target.value || undefined) as typeof agy.effort })}
                  >
                    <option value="">(default)</option>
                    {EFFORT_3.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mode
                  <select
                    value={agy.mode ?? ""}
                    onChange={(e) => setHarness({ ...agy, mode: (e.target.value || undefined) as typeof agy.mode })}
                  >
                    <option value="">(default)</option>
                    <option value="accept-edits">accept-edits</option>
                    <option value="plan">plan</option>
                  </select>
                </label>
                <label>
                  Additional dirs (comma-separated)
                  <input
                    value={addDirsValue(agy.addDirs)}
                    onChange={(e) => setHarness({ ...agy, addDirs: parseAddDirs(e.target.value) })}
                  />
                </label>
              </>
            );
          })()}

        {node.harness.type === "omp" &&
          (() => {
            const omp = node.harness as Extract<AgentFlowHarness, { type: "omp" }>;
            return (
              <>
                <label>
                  Initial prompt
                  <textarea
                    value={omp.initialPrompt ?? ""}
                    onChange={(e) => setHarness({ ...omp, initialPrompt: e.target.value })}
                    rows={3}
                  />
                </label>
                <AgentTemplatePicker
                  value={omp.initialPrompt ?? ""}
                  onChange={(v) => setHarness({ ...omp, initialPrompt: v })}
                  onCreateRoleNode={onCreateRoleNode}
                />
                <label>
                  System prompt (appended)
                  <textarea
                    value={omp.systemPromptAppend ?? ""}
                    onChange={(e) => setHarness({ ...omp, systemPromptAppend: e.target.value })}
                    rows={3}
                  />
                </label>
                <label>
                  Model
                  <input
                    value={omp.model ?? ""}
                    onChange={(e) => setHarness({ ...omp, model: e.target.value || undefined })}
                    placeholder="(default) — fuzzy match, e.g. opus, gpt-5.2"
                  />
                </label>
                <label>
                  Thinking
                  <select
                    value={omp.thinking ?? ""}
                    onChange={(e) =>
                      setHarness({ ...omp, thinking: (e.target.value || undefined) as typeof omp.thinking })
                    }
                  >
                    <option value="">(default)</option>
                    {OMP_THINKING.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Approval mode
                  <select
                    value={omp.approvalMode ?? ""}
                    onChange={(e) =>
                      setHarness({ ...omp, approvalMode: (e.target.value || undefined) as typeof omp.approvalMode })
                    }
                  >
                    <option value="">(default)</option>
                    {OMP_APPROVAL_MODES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Additional dirs (comma-separated)
                  <input
                    value={addDirsValue(omp.addDirs)}
                    onChange={(e) => setHarness({ ...omp, addDirs: parseAddDirs(e.target.value) })}
                  />
                </label>
              </>
            );
          })()}

        {node.harness.type === "copilot" &&
          (() => {
            const copilot = node.harness as Extract<AgentFlowHarness, { type: "copilot" }>;
            return (
              <>
                <label>
                  Initial prompt
                  <textarea
                    value={copilot.initialPrompt ?? ""}
                    onChange={(e) => setHarness({ ...copilot, initialPrompt: e.target.value })}
                    rows={3}
                  />
                </label>
                <AgentTemplatePicker
                  value={copilot.initialPrompt ?? ""}
                  onChange={(v) => setHarness({ ...copilot, initialPrompt: v })}
                  onCreateRoleNode={onCreateRoleNode}
                />
                <label>
                  Model
                  <input
                    value={copilot.model ?? ""}
                    onChange={(e) => setHarness({ ...copilot, model: e.target.value || undefined })}
                    placeholder="(default)"
                  />
                </label>
                <label className="flow-node-checkbox">
                  <input
                    type="checkbox"
                    checked={copilot.allowAllTools ?? false}
                    onChange={(e) => setHarness({ ...copilot, allowAllTools: e.target.checked || undefined })}
                  />
                  Allow all tools (--allow-all-tools, skips permission prompts)
                </label>
                <label>
                  Additional dirs (comma-separated)
                  <input
                    value={addDirsValue(copilot.addDirs)}
                    onChange={(e) => setHarness({ ...copilot, addDirs: parseAddDirs(e.target.value) })}
                  />
                </label>
              </>
            );
          })()}

        <label className="flow-node-communication">
          Communication note (not yet wired to any real messaging)
          <input
            value={node.communication ?? ""}
            onChange={(e) => onChange({ ...node, communication: e.target.value || undefined })}
            placeholder="e.g. reports findings to Supervisor"
          />
        </label>
      </div>

      <div className="node-config-drawer-footer">
        <button type="button" className="icon-btn" onClick={onDelete}>
          Delete node
        </button>
      </div>
    </div>
  );
}
