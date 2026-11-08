import { useI18n } from "../i18n/index.js";
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
  const { t } = useI18n();
  return (
    <div className="flow-supervisor">
      <h3>{t("flow.supervisor.title")}</h3>
      <p className="muted flow-supervisor-note">
        {t("flow.supervisor.note")}
      </p>
      <label>
        {t("flow.supervisor.type")}
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
            {t("flow.supervisor.agent")}
            <select
              value={supervisor.agentId ?? ""}
              onChange={(e) => onChange({ ...supervisor, agentId: e.target.value || undefined })}
            >
              <option value="">{t("flow.supervisor.selectAgent")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label ?? a.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("flow.supervisor.initialPromptRun")}
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
          {t("flow.supervisor.systemPrompt")}
          <textarea
            value={supervisor.systemPromptAppend ?? ""}
            onChange={(e) => onChange({ ...supervisor, systemPromptAppend: e.target.value || undefined })}
            rows={3}
          />
        </label>
      )}

      {(supervisor.type === "antigravity" || supervisor.type === "omp" || supervisor.type === "copilot") && (
        <label>
          {t("flow.supervisor.initialPrompt")}
          <textarea
            value={supervisor.initialPrompt ?? ""}
            onChange={(e) => onChange({ ...supervisor, initialPrompt: e.target.value || undefined })}
            rows={3}
          />
        </label>
      )}

      <label>
        {t("flow.supervisor.noteLabel")}
        <input
          value={supervisor.note ?? ""}
          onChange={(e) => onChange({ ...supervisor, note: e.target.value || undefined })}
          placeholder={t("flow.supervisor.notePlaceholder")}
        />
      </label>
    </div>
  );
}
