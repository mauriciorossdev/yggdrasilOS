import { useCallback, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { AgentInfo, ConfigGetResult, ConfigShape, ProviderInfo } from "../types.js";
import { useI18n } from "../i18n/index.js";
import { AgentManager } from "../agents/AgentManager.js";
import { emitAgentsChanged } from "../agents/agentsEvents.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  providers: ProviderInfo[];
  onGoToProviders?: () => void;
};

/**
 * Settings → Agents: which agent the chat starts with, plus every agent's own
 * prompt/model/tools (AgentManager). The manager saves through the gateway right
 * away, unlike the rest of Settings (the Save button's config.patch).
 */
export function AgentSection({ config, setConfig, onGoToProviders }: Props) {
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
  // Setting the default is immediate (like every other change in this list), not a Save-button field.
  const setDefaultAgent = async (id: string) => {
    try {
      await call("config.patch", { defaultAgent: id });
      setConfig({ ...config, defaultAgent: id });
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="settings-section">
      <h3>{t("set.agent.title")}</h3>
      <h4>{t("set.agent.listTitle")}</h4>
      <p className="muted">{t("set.agent.listIntro")}</p>
      {listError && <p className="error">{listError}</p>}
      <AgentManager
        agents={agents}
        defaultAgentId={config.defaultAgent ?? config.agents?.[0]?.id}
        onSetDefault={(id) => void setDefaultAgent(id)}
        onGoToProviders={onGoToProviders}
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
