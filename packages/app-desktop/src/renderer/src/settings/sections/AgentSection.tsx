import { useCallback, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { AgentInfo, ConfigGetResult, ConfigShape, ProviderInfo } from "../../types.js";
import { useI18n } from "../../i18n/index.js";
import { AgentManager } from "../../agents/AgentManager.js";
import { emitAgentsChanged } from "../../agents/agentsEvents.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  providers: ProviderInfo[];
};

/**
 * Settings → Agents: which agent the chat starts with, plus every agent's own
 * prompt/model/tools (AgentManager). The manager saves through the gateway right
 * away, unlike the rest of Settings (the Save button's config.patch).
 */
export function AgentSection({ config, setConfig, providers }: Props) {
  const { t } = useI18n();
  const { call } = useGateway();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    call<{ agents: AgentInfo[] }>("agents.list")
      .then((res) => setAgents(res.agents ?? []))
      .catch((err) => setListError(err instanceof Error ? err.message : String(err)));
  }, [call]);

  // The Save button sends config.agents whole: re-read it after the manager changed an
  // agent, or saving would put back the list as it was when Settings opened.
  const resyncConfig = useCallback(async () => {
    try {
      const fresh = (await call<ConfigGetResult>("config.get")).config;
      const ids = new Set((fresh.agents ?? []).map((a) => a.id));
      const defaultAgent = config.defaultAgent && ids.has(config.defaultAgent) ? config.defaultAgent : fresh.defaultAgent;
      setConfig({ ...config, agents: fresh.agents, defaultAgent });
    } catch {
      // Leave the form as is; the list itself already reflects the change.
    }
  }, [call, config, setConfig]);
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

      <h4>{t("set.agent.listTitle")}</h4>
      <p className="muted">{t("set.agent.listIntro")}</p>
      {listError && <p className="error">{listError}</p>}
      <AgentManager
        agents={agents}
        onCreated={(next, id) => {
          setAgents(next);
          emitAgentsChanged({ kind: "saved", agents: next, agentId: id });
          void resyncConfig();
        }}
        onDeleted={(next, id) => {
          setAgents(next);
          emitAgentsChanged({ kind: "deleted", agents: next, agentId: id });
          void resyncConfig();
        }}
      />
    </section>
  );
}
