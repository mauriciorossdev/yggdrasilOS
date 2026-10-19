import type { ConfigShape, ProviderInfo } from "../../types.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  providers: ProviderInfo[];
};

export function AgentSection({ config, setConfig, providers }: Props) {
  const agent = config.agents?.find((a) => a.id === config.defaultAgent) ?? config.agents?.[0];
  const models = providers.find((p) => p.id === agent?.provider)?.models ?? [];

  const update = (field: "provider" | "model" | "systemPrompt", value: string) => {
    if (!agent) return;
    const agents = (config.agents ?? []).map((a) => (a.id === agent.id ? { ...a, [field]: value } : a));
    setConfig({ ...config, agents });
  };

  return (
    <section className="settings-section">
      <h3>Agent</h3>
      <label>
        Provider
        <select value={agent?.provider ?? ""} onChange={(e) => update("provider", e.target.value)}>
          <option value="">(none)</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        <select value={agent?.model ?? ""} onChange={(e) => update("model", e.target.value)} disabled={models.length === 0}>
          <option value="">(default)</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Persona / system prompt
        <textarea
          value={agent?.systemPrompt ?? ""}
          onChange={(e) => update("systemPrompt", e.target.value)}
          rows={4}
        />
      </label>
    </section>
  );
}
