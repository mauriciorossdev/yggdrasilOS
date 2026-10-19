import type { AgentFlowSupervisor, AgentInfo } from "../types.js";

type Props = {
  supervisor: AgentFlowSupervisor;
  agents: AgentInfo[];
  onChange: (supervisor: AgentFlowSupervisor) => void;
};

/**
 * Persisted config for the flow's entry point. For a yggdrasil supervisor,
 * "Run Flow" (AgentFlowView) actually spawns it — chat.send with
 * initialPrompt, scoped via invoke_agent to the flow's edges. Other
 * supervisor types stay config-only for now (no autonomous run path yet).
 */
export function SupervisorPanel({ supervisor, agents, onChange }: Props) {
  return (
    <div className="flow-supervisor">
      <h3>Supervisor</h3>
      <p className="muted flow-supervisor-note">
        Orchestrates the flow — "Run Flow" only works for a yggdrasil supervisor with an agent and initial prompt
        set.
      </p>
      <label>
        Type
        <select
          value={supervisor.type}
          onChange={(e) => onChange({ type: e.target.value as AgentFlowSupervisor["type"] })}
        >
          <option value="human">human</option>
          <option value="yggdrasil">yggdrasil</option>
          <option value="claude">claude</option>
          <option value="antigravity">antigravity</option>
          <option value="omp">omp</option>
          <option value="copilot">copilot</option>
        </select>
      </label>

      {supervisor.type === "yggdrasil" && (
        <>
          <label>
            Agent
            <select
              value={supervisor.agentId ?? ""}
              onChange={(e) => onChange({ ...supervisor, agentId: e.target.value || undefined })}
            >
              <option value="">(select an agent)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label ?? a.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Initial prompt (used by "Run Flow")
            <textarea
              value={supervisor.initialPrompt ?? ""}
              onChange={(e) => onChange({ ...supervisor, initialPrompt: e.target.value || undefined })}
              rows={3}
            />
          </label>
        </>
      )}

      {supervisor.type === "claude" && (
        <label>
          System prompt (appended)
          <textarea
            value={supervisor.systemPromptAppend ?? ""}
            onChange={(e) => onChange({ ...supervisor, systemPromptAppend: e.target.value || undefined })}
            rows={3}
          />
        </label>
      )}

      {(supervisor.type === "antigravity" || supervisor.type === "omp" || supervisor.type === "copilot") && (
        <label>
          Initial prompt
          <textarea
            value={supervisor.initialPrompt ?? ""}
            onChange={(e) => onChange({ ...supervisor, initialPrompt: e.target.value || undefined })}
            rows={3}
          />
        </label>
      )}

      <label>
        Note
        <input
          value={supervisor.note ?? ""}
          onChange={(e) => onChange({ ...supervisor, note: e.target.value || undefined })}
          placeholder="Free-form notes about orchestration intent"
        />
      </label>
    </div>
  );
}
