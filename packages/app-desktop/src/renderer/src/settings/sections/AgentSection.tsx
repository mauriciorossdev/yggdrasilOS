import type { ConfigShape, ProviderInfo } from "../../types.js";
import { useI18n } from "../../i18n/index.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  providers: ProviderInfo[];
};

export function AgentSection({ config, setConfig, providers }: Props) {
  const { t } = useI18n();
  const defaultAgent = config.agents?.find((a) => a.id === config.defaultAgent) ?? config.agents?.[0];
  const models = providers.find((p) => p.id === defaultAgent?.provider)?.models ?? [];

  const updateDefaultAgent = (field: "provider" | "model", value: string) => {
    if (!defaultAgent) return;
    const agents = (config.agents ?? []).map((a) => (a.id === defaultAgent.id ? { ...a, [field]: value } : a));
    setConfig({ ...config, agents });
  };

  return (
    <section className="settings-section">
      <h3>{t("set.agent.title")}</h3>
      <label>
        {t("set.agent.default")}
        <select
          value={config.defaultAgent ?? ""}
          onChange={(e) => setConfig({ ...config, defaultAgent: e.target.value })}
        >
          {(config.agents ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label ?? a.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("set.agent.provider")}
        <select value={defaultAgent?.provider ?? ""} onChange={(e) => updateDefaultAgent("provider", e.target.value)}>
          <option value="">{t("set.agent.none")}</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("set.agent.model")}
        <select
          value={defaultAgent?.model ?? ""}
          onChange={(e) => updateDefaultAgent("model", e.target.value)}
          disabled={models.length === 0}
        >
          <option value="">{t("set.agent.modelDefault")}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
