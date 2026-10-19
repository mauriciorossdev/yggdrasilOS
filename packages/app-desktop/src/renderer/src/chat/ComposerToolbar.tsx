import type { AgentInfo, ApprovalMode, ProviderInfo } from "../types.js";
import type { ModelOverride } from "./chatReducer.js";

type Props = {
  agents: AgentInfo[];
  activeAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  providers: ProviderInfo[];
  modelOverride: ModelOverride | null;
  onSelectModel: (override: ModelOverride | null) => void;
  mode: ApprovalMode;
  onSelectMode: (mode: ApprovalMode) => void;
};

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
  providers,
  modelOverride,
  onSelectModel,
  mode,
  onSelectMode,
}: Props) {
  return (
    <div className="composer-toolbar">
      <select
        className="composer-pill"
        value={activeAgentId ?? ""}
        onChange={(e) => onSelectAgent(e.target.value)}
        disabled={agents.length === 0}
        title="Agent"
      >
        {agents.length === 0 && <option value="">No agents</option>}
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label ?? a.id}
          </option>
        ))}
      </select>

      <select
        className="composer-pill"
        value={modelOverride ? encode(modelOverride) : ""}
        onChange={(e) => onSelectModel(decode(e.target.value))}
        disabled={providers.length === 0}
        title="Model"
      >
        <option value="">Agent&apos;s default model</option>
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
        title="Tool-approval mode — or Shift+Tab in the message box to cycle"
      >
        <option value="auto">Auto</option>
        <option value="plan">Plan</option>
        <option value="restrict">Restrict</option>
        <option value="yolo">Yolo</option>
      </select>
    </div>
  );
}
