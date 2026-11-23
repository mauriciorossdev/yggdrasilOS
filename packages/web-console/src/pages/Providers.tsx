import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { ProvidersSection, type ConfigGetResult, type ConfigShape, type ProviderInfo, type ProviderSources } from "@yggdrasil/ui-kit";
import { useT } from "../i18n";

/** The desktop app's Settings → Providers, from the kit: saves to the global providers by default. */
export function ProvidersPage() {
  const { call, connected } = useGateway();
  const t = useT();
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [apiKeyEdits, setApiKeyEdits] = useState<Record<string, string>>({});
  const [loadedProviders, setLoadedProviders] = useState<ConfigShape["providers"]>({});
  const [providerSources, setProviderSources] = useState<ProviderSources>({});
  const [projectOnly, setProjectOnly] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    void (async () => {
      try {
        const [cfg, list] = await Promise.all([
          call<ConfigGetResult>("config.get"),
          call<{ providers: ProviderInfo[] }>("providers.list"),
        ]);
        setConfig(cfg.config);
        setLoadedProviders(cfg.config.providers ?? {});
        setProviderSources(cfg.providerSources ?? {});
        setProviders(list.providers ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [connected, call]);

  return (
    <div className="page settings-page">
      <h1>{t("nav.providers")}</h1>
      {error && <p className="error">{error}</p>}
      {!config ? (
        <p className="muted">{t("common.loading")}</p>
      ) : (
        <div className="card">
          <ProvidersSection
            config={config}
            setConfig={setConfig}
            providers={providers}
            apiKeyEdits={apiKeyEdits}
            setApiKeyEdits={setApiKeyEdits}
            onProvidersChanged={setProviders}
            loadedProviders={loadedProviders}
            setLoadedProviders={setLoadedProviders}
            providerSources={providerSources}
            setProviderSources={setProviderSources}
            projectOnly={projectOnly}
            setProjectOnly={setProjectOnly}
          />
        </div>
      )}
    </div>
  );
}
