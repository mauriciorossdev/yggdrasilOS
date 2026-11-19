import type { AgentInfo, ApprovalMode, ProviderInfo } from "../types.js";
import type { ModelOverride } from "./chatReducer.js";
import { useI18n } from "../i18n/index.js";
import type { TerminalPaneSummary } from "../terminal/terminalPanesStore.js";

type Props = {
  agents: AgentInfo[];
  activeAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  /** Opens Settings → Agents (the last entry of the agent picker). */
  onManageAgents: () => void;
  providers: ProviderInfo[];
  modelOverride: ModelOverride | null;
  onSelectModel: (override: ModelOverride | null) => void;
  mode: ApprovalMode;
  onSelectMode: (mode: ApprovalMode) => void;
  /** Live terminal panes that can be shown beside the chat (read-only mirror). */
  terminalPanes?: TerminalPaneSummary[];
  onOpenTerminalPanel?: (paneId: string) => void;
};

/** Not an agent id: picking it opens Settings → Agents and leaves the selection as it was. */
const MANAGE_AGENTS = "__manage-agents__";

function encode(o: ModelOverride): string {
  return `${o.provider}::${o.model}`;
}

function decode(value: string): ModelOverride | null {
  if (!value) return null;
  const [provider, model] = value.split("::");
  return provider && model ? { provider, model } : null;
}

export function ComposerToolbar({
  agents,
  activeAgentId,
  onSelectAgent,
  onManageAgents,
  providers,
  modelOverride,
  onSelectModel,
  mode,
  onSelectMode,
  terminalPanes,
  onOpenTerminalPanel,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="composer-toolbar">
      <select
        className="composer-pill"
        value={activeAgentId ?? ""}
        onChange={(e) => (e.target.value === MANAGE_AGENTS ? onManageAgents() : onSelectAgent(e.target.value))}
        title={t("chat.composer.agent")}
      >
        {agents.length === 0 && <option value="">{t("chat.composer.noAgents")}</option>}
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label ?? a.id}
          </option>
        ))}
        <option disabled>──────────</option>
        <option value={MANAGE_AGENTS}>{t("chat.composer.manageAgents")}</option>
      </select>

      <select
        className="composer-pill"
        value={modelOverride ? encode(modelOverride) : ""}
        onChange={(e) => onSelectModel(decode(e.target.value))}
        disabled={providers.length === 0}
        title={t("chat.composer.model")}
      >
        <option value="">{t("chat.composer.defaultModel")}</option>
        {providers.map((p) => (
          <optgroup key={p.id} label={p.label}>
            {p.models.map((m) => (
              <option key={m.id} value={encode({ provider: p.id, model: m.id })}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        className="composer-pill"
        value={mode}
        onChange={(e) => onSelectMode(e.target.value as ApprovalMode)}
        title={t("chat.composer.modeTitle")}
      >
        <option value="auto">{t("chat.composer.modeAuto")}</option>
        <option value="plan">{t("chat.composer.modePlan")}</option>
        <option value="restrict">{t("chat.composer.modeRestrict")}</option>
        <option value="yolo">{t("chat.composer.modeYolo")}</option>
      </select>

      {onOpenTerminalPanel && terminalPanes && terminalPanes.length > 0 && (
        // Always back on the placeholder: this is an action, not a setting.
        <select
          className="composer-pill"
          value=""
          onChange={(e) => e.target.value && onOpenTerminalPanel(e.target.value)}
          title={t("chat.composer.terminalPanelTitle")}
        >
          <option value="">{t("chat.composer.terminalPanel")}</option>
          {terminalPanes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
