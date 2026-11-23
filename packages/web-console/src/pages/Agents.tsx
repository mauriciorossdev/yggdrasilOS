import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGateway } from "@yggdrasil/client-web";
import { AgentSection, type ConfigGetResult, type ConfigShape, type ProviderInfo } from "@yggdrasil/ui-kit";
import { useT } from "../i18n";

/** The desktop app's Settings → Agents, from the kit: default agent, create, edit, delete. */
export function AgentsPage() {
  const { call, connected } = useGateway();
  const t = useT();
  const navigate = useNavigate();
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    call<ConfigGetResult>("config.get")
      .then((cfg) => setConfig(cfg.config))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    call<{ providers: ProviderInfo[] }>("providers.list")
      .then((r) => setProviders(r.providers ?? []))
      .catch(() => undefined);
  }, [connected, call]);

  return (
    <div className="page settings-page">
      <h1>{t("nav.agents")}</h1>
      {error && <p className="error">{error}</p>}
      {!config ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <div className="card">
          <AgentSection config={config} setConfig={setConfig} providers={providers} onGoToProviders={() => navigate("/providers")} />
        </div>
      )}
    </div>
  );
}
