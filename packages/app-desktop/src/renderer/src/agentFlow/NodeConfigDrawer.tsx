import { useState } from "react";
import { useI18n } from "../i18n/index.js";
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
const YGG_APPROVAL_MODES = ["auto", "plan", "restrict", "yolo"] as const;
const OMP_APPROVAL_MODES = ["always-ask", "write", "yolo"] as const;
const CLAUDE_PERMISSION_MODES = ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"] as const;

const splitList = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Keeps the raw text while typing: re-deriving it from the parsed list would eat the trailing comma.
function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(splitList(e.target.value));
      }}
      placeholder={placeholder}
    />
  );
}

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
  const { t } = useI18n();
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
          placeholder={t("flow.drawer.nodeNamePlaceholder")}
          autoFocus
        />
        <button type="button" className="icon-btn" onClick={onClose} title={t("flow.drawer.close")}>
          <XMarkIcon className="hero-icon" />
        </button>
      </div>

      <div className="node-config-drawer-body">
        <label>
          {t("flow.drawer.harness")}
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
        <label className="flow-node-checkbox">
          <input
            type="checkbox"
            checked={node.worktree ?? false}
            onChange={(e) => onChange({ ...node, worktree: e.target.checked || undefined })}
          />
          {t("flow.drawer.isolatedWorktree")}
        </label>
        <p className="flow-node-hint">
          {node.worktree ? t("flow.drawer.worktreeOn") : t("flow.drawer.worktreeOff")}
        </p>

        {node.harness.type === "yggdrasil" &&
          (() => {
            const ygg = node.harness as Extract<AgentFlowHarness, { type: "yggdrasil" }>;
            return (
              <>
                <label>
                  {t("flow.drawer.agent")}
                  <div className="flow-node-agent-row">
                    <select value={ygg.agentId} onChange={(e) => setHarness({ ...ygg, agentId: e.target.value })}>
                      <option value="">{t("flow.drawer.selectAgent")}</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label ?? a.id}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t("flow.drawer.deleteAgent")}
                      disabled={!ygg.agentId}
                      onClick={() => onDeleteAgent(ygg.agentId)}
                    >
                      <TrashIcon className="hero-icon" />
                    </button>
                  </div>
                </label>
                <label className="flow-node-checkbox">
                  <input
                    type="checkbox"
                    checked={ygg.continueSession ?? false}
                    onChange={(e) => setHarness({ ...ygg, continueSession: e.target.checked || undefined })}
                  />
                  {t("flow.drawer.continueConv")}
                </label>
                <label>
                  {t("flow.drawer.initialPrompt")}
                  <textarea
                    value={ygg.initialPrompt ?? ""}
                    onChange={(e) => setHarness({ ...ygg, initialPrompt: e.target.value || undefined })}
                    rows={3}
                  />
                </label>
                <label>
                  {t("flow.drawer.model")}
                  <input
                    value={ygg.model ?? ""}
                    onChange={(e) => setHarness({ ...ygg, model: e.target.value || undefined })}
                    placeholder={t("flow.drawer.modelOwn")}
                  />
                </label>
                <label>
                  {t("flow.drawer.approvalMode")}
                  <select
                    value={ygg.approvalMode ?? ""}
                    onChange={(e) =>
                      setHarness({ ...ygg, approvalMode: (e.target.value || undefined) as typeof ygg.approvalMode })
                    }
                  >
                    <option value="">{t("flow.drawer.default")}</option>
                    {YGG_APPROVAL_MODES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                {ygg.approvalMode === "yolo" && (
                  <p className="flow-node-warning">{t("flow.drawer.yoloWarn")}</p>
                )}
                {!showNewAgent ? (
                  <button type="button" className="link-btn" onClick={() => setShowNewAgent(true)}>
                    {t("flow.drawer.newAgent")}
                  </button>
                ) : (
                  <div className="flow-node-new-agent">
                    <input
                      value={newAgentId}
                      onChange={(e) => setNewAgentId(e.target.value)}
                      placeholder={t("flow.drawer.newAgentId")}
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
                      {t("flow.drawer.create")}
                    </button>
                    <button type="button" onClick={() => setShowNewAgent(false)}>
                      {t("flow.drawer.cancel")}
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
                  {t("flow.drawer.initialPrompt")}
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
                  {t("flow.drawer.systemPrompt")}
                  <textarea
                    value={claude.systemPromptAppend ?? ""}
                    onChange={(e) => setHarness({ ...claude, systemPromptAppend: e.target.value })}
                    rows={3}
                  />
                </label>
                <label>
                  {t("flow.drawer.model")}
                  <input
                    value={claude.model ?? ""}
                    onChange={(e) => setHarness({ ...claude, model: e.target.value || undefined })}
                    placeholder={t("flow.drawer.default")}
                  />
                </label>
                <label>
                  {t("flow.drawer.effort")}
                  <select
                    value={claude.effort ?? ""}
                    onChange={(e) =>
                      setHarness({ ...claude, effort: (e.target.value || undefined) as typeof claude.effort })
                    }
                  >
                    <option value="">{t("flow.drawer.default")}</option>
                    {EFFORT_5.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("flow.drawer.session")}
                  <select
                    value={claude.resumeSession !== undefined ? "resume" : claude.continueSession ? "continue" : "new"}
                    onChange={(e) =>
                      setHarness({
                        ...claude,
                        continueSession: e.target.value === "continue" || undefined,
                        resumeSession: e.target.value === "resume" ? (claude.resumeSession ?? "") : undefined,
                      })
                    }
                  >
                    <option value="new">{t("flow.drawer.sessionNew")}</option>
                    <option value="continue">{t("flow.drawer.sessionContinue")}</option>
                    <option value="resume">{t("flow.drawer.sessionResume")}</option>
                  </select>
                </label>
                {claude.resumeSession !== undefined && (
                  <label>
                    {t("flow.drawer.sessionIdOrName")}
                    <input
                      value={claude.resumeSession}
                      onChange={(e) => setHarness({ ...claude, resumeSession: e.target.value })}
                      placeholder={t("flow.drawer.sessionIdPlaceholder")}
                    />
                  </label>
                )}
                <label>
                  {t("flow.drawer.sessionName")}
                  <input
                    value={claude.sessionName ?? ""}
                    onChange={(e) => setHarness({ ...claude, sessionName: e.target.value || undefined })}
                    placeholder={t("flow.drawer.sessionNamePlaceholder")}
                  />
                </label>
                <label>
                  {t("flow.drawer.permissionMode")}
                  <select
                    value={claude.permissionMode ?? ""}
                    onChange={(e) =>
                      setHarness({ ...claude, permissionMode: (e.target.value || undefined) as typeof claude.permissionMode })
                    }
                  >
                    <option value="">{t("flow.drawer.default")}</option>
                    {CLAUDE_PERMISSION_MODES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                {claude.permissionMode === "bypassPermissions" && (
                  <p className="flow-node-warning">
                    {t("flow.drawer.bypassWarn")}
                  </p>
                )}
                <label>
                  {t("flow.drawer.allowedTools")}
                  <ListInput
                    value={claude.allowedTools ?? []}
                    onChange={(v) => setHarness({ ...claude, allowedTools: v.length ? v : undefined })}
                    placeholder="Read, Bash(git log:*)"
                  />
                </label>
                <label>
                  {t("flow.drawer.disallowedTools")}
                  <ListInput
                    value={claude.disallowedTools ?? []}
                    onChange={(v) => setHarness({ ...claude, disallowedTools: v.length ? v : undefined })}
                    placeholder="Bash(rm:*)"
                  />
                </label>
                <label>
                  {t("flow.drawer.addDirs")}
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
                  {t("flow.drawer.cloud")}
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
                  {t("flow.drawer.initialPrompt")}
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
                  {t("flow.drawer.model")}
                  <input
                    value={agy.model ?? ""}
                    onChange={(e) => setHarness({ ...agy, model: e.target.value || undefined })}
                    placeholder={t("flow.drawer.default")}
                  />
                </label>
                <label>
                  {t("flow.drawer.effort")}
                  <select
                    value={agy.effort ?? ""}
                    onChange={(e) => setHarness({ ...agy, effort: (e.target.value || undefined) as typeof agy.effort })}
                  >
                    <option value="">{t("flow.drawer.default")}</option>
                    {EFFORT_3.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("flow.drawer.mode")}
                  <select
                    value={agy.mode ?? ""}
                    onChange={(e) => setHarness({ ...agy, mode: (e.target.value || undefined) as typeof agy.mode })}
                  >
                    <option value="">{t("flow.drawer.default")}</option>
                    <option value="accept-edits">accept-edits</option>
                    <option value="plan">plan</option>
                  </select>
                </label>
                <label>
                  {t("flow.drawer.addDirs")}
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
                  {t("flow.drawer.initialPrompt")}
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
                  {t("flow.drawer.systemPrompt")}
                  <textarea
                    value={omp.systemPromptAppend ?? ""}
                    onChange={(e) => setHarness({ ...omp, systemPromptAppend: e.target.value })}
                    rows={3}
                  />
                </label>
                <label>
                  {t("flow.drawer.model")}
                  <input
                    value={omp.model ?? ""}
                    onChange={(e) => setHarness({ ...omp, model: e.target.value || undefined })}
                    placeholder={t("flow.drawer.modelFuzzy")}
                  />
                </label>
                <label>
                  {t("flow.drawer.thinking")}
                  <select
                    value={omp.thinking ?? ""}
                    onChange={(e) =>
                      setHarness({ ...omp, thinking: (e.target.value || undefined) as typeof omp.thinking })
                    }
                  >
                    <option value="">{t("flow.drawer.default")}</option>
                    {OMP_THINKING.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("flow.drawer.approvalMode")}
                  <select
                    value={omp.approvalMode ?? ""}
                    onChange={(e) =>
                      setHarness({ ...omp, approvalMode: (e.target.value || undefined) as typeof omp.approvalMode })
                    }
                  >
                    <option value="">{t("flow.drawer.default")}</option>
                    {OMP_APPROVAL_MODES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("flow.drawer.addDirs")}
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
                  {t("flow.drawer.initialPrompt")}
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
                  {t("flow.drawer.model")}
                  <input
                    value={copilot.model ?? ""}
                    onChange={(e) => setHarness({ ...copilot, model: e.target.value || undefined })}
                    placeholder={t("flow.drawer.default")}
                  />
                </label>
                <label className="flow-node-checkbox">
                  <input
                    type="checkbox"
                    checked={copilot.allowAllTools ?? false}
                    onChange={(e) => setHarness({ ...copilot, allowAllTools: e.target.checked || undefined })}
                  />
                  {t("flow.drawer.allowAll")}
                </label>
                <label>
                  {t("flow.drawer.addDirs")}
                  <input
                    value={addDirsValue(copilot.addDirs)}
                    onChange={(e) => setHarness({ ...copilot, addDirs: parseAddDirs(e.target.value) })}
                  />
                </label>
              </>
            );
          })()}

        <label className="flow-node-communication">
          {t("flow.drawer.comm")}
          <input
            value={node.communication ?? ""}
            onChange={(e) => onChange({ ...node, communication: e.target.value || undefined })}
            placeholder={t("flow.drawer.commPlaceholder")}
          />
        </label>
      </div>

      <div className="node-config-drawer-footer">
        <button type="button" className="icon-btn" onClick={onDelete}>
          {t("flow.drawer.deleteNode")}
        </button>
      </div>
    </div>
  );
}
