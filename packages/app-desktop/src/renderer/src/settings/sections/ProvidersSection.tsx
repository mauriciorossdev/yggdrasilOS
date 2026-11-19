import { useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { ConfigGetResult, ConfigShape, ProviderInfo } from "../../types.js";
import { useI18n } from "../../i18n/index.js";
import { Chip } from "../../ui/index.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  providers: ProviderInfo[];
  apiKeyEdits: Record<string, string>;
  setApiKeyEdits: (edits: Record<string, string>) => void;
  /** Called with the fresh provider list after a card's "Save & test" so the parent's copy (e.g. Agents' model picker) stays current. */
  onProvidersChanged?: (providers: ProviderInfo[]) => void;
};

type ProviderMeta = {
  /** Real default base URL (each provider package's provider.ts) — shown as a placeholder. */
  defaultBaseUrl: string;
  /** Whether this provider authenticates with an API key. */
  needsKey: boolean;
  keyPlaceholder?: string;
  /** Where the user creates a key. */
  keyUrl?: string;
};

const PROVIDER_META: Record<string, ProviderMeta> = {
  anthropic: {
    defaultBaseUrl: "https://api.anthropic.com",
    needsKey: true,
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  "openai-compat": {
    defaultBaseUrl: "https://api.openai.com/v1",
    needsKey: true,
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  ollama: { defaultBaseUrl: "http://127.0.0.1:11434", needsKey: false },
};

// Cloud providers first: that's the path most people are looking for.
const ORDER = ["anthropic", "openai-compat", "ollama"];
const sortProviders = (list: ProviderInfo[]) =>
  [...list].sort((a, b) => {
    const ia = ORDER.indexOf(a.id);
    const ib = ORDER.indexOf(b.id);
    return (ia === -1 ? ORDER.length : ia) - (ib === -1 ? ORDER.length : ib);
  });

export function ProvidersSection({ config, setConfig, providers, apiKeyEdits, setApiKeyEdits, onProvidersChanged }: Props) {
  const { t } = useI18n();
  const { call } = useGateway();
  const [testing, setTesting] = useState<string | null>(null);
  const [justTested, setJustTested] = useState<Record<string, boolean>>({});

  const updateBaseUrl = (id: string, baseUrl: string) => {
    setConfig({
      ...config,
      providers: { ...config.providers, [id]: { ...config.providers?.[id], baseUrl: baseUrl || undefined } },
    });
  };

  // Persist just this card's fields, then re-list so the card shows the real outcome
  // (models loaded, or the provider's own error for a bad key/host).
  const saveAndTest = async (id: string) => {
    setTesting(id);
    try {
      const entry = config.providers?.[id];
      const key = apiKeyEdits[id];
      await call("config.patch", {
        providers: { [id]: { ...(entry?.baseUrl ? { baseUrl: entry.baseUrl } : {}), ...(key ? { apiKey: key } : {}) } },
      });
      const [list, fresh] = await Promise.all([
        call<{ providers: ProviderInfo[] }>("providers.list"),
        call<ConfigGetResult>("config.get"),
      ]);
      const { [id]: _saved, ...restEdits } = apiKeyEdits;
      setApiKeyEdits(restEdits);
      // Only this provider's persisted fields are refreshed; other unsaved form edits survive.
      setConfig({ ...config, providers: { ...config.providers, [id]: fresh.config.providers?.[id] ?? {} } });
      onProvidersChanged?.(list.providers ?? []);
      setJustTested({ ...justTested, [id]: true });
    } catch {
      // The gateway call itself failed; the card keeps its previous status.
    } finally {
      setTesting(null);
    }
  };

  return (
    <section className="settings-section">
      <h3>{t("set.providers.title")}</h3>
      <p className="muted">{t("set.prov.intro")}</p>
      {sortProviders(providers).map((p) => {
        const meta = PROVIDER_META[p.id] ?? { defaultBaseUrl: "https://…", needsKey: false };
        const needsKey = p.needsKey ?? meta.needsKey;
        // `configured` also covers a key coming from an env var, which config.get never shows.
        const hasKey = p.configured ?? Boolean(config.providers?.[p.id]?.apiKey);
        const pendingKey = Boolean(apiKeyEdits[p.id]);
        const customUrl = Boolean(config.providers?.[p.id]?.baseUrl);
        return (
          <div key={p.id} className="settings-provider">
            <div className="provider-card-head">
              <strong>{p.label}</strong>
              {p.error ? (
                <Chip tone="danger">{t("set.prov.statusError")}</Chip>
              ) : needsKey && !hasKey && !pendingKey ? (
                <Chip tone="neutral">{t("set.prov.statusNoKey")}</Chip>
              ) : pendingKey ? (
                <Chip tone="attention">{t("set.prov.statusUnsaved")}</Chip>
              ) : (
                <Chip tone="ready">{t("set.prov.statusConnected", { count: p.models.length })}</Chip>
              )}
            </div>
            {p.error && (
              <p className="provider-warning">{t("set.providers.unreachable", { error: p.error })}</p>
            )}
            {needsKey && (
              <label>
                {t("set.providers.apiKey", { label: p.label })}
                <input
                  type="password"
                  value={apiKeyEdits[p.id] ?? ""}
                  onChange={(e) => setApiKeyEdits({ ...apiKeyEdits, [p.id]: e.target.value })}
                  placeholder={hasKey ? t("set.prov.keySavedPlaceholder") : (meta.keyPlaceholder ?? "")}
                  autoComplete="off"
                />
                {meta.keyUrl && (
                  <button
                    type="button"
                    className="onboarding-link"
                    onClick={() => void window.yggdrasil.onboarding.openExternal(meta.keyUrl!)}
                  >
                    {t("set.prov.getKey")}
                  </button>
                )}
              </label>
            )}
            <details open={customUrl || !needsKey}>
              <summary>{t("set.prov.advanced")}</summary>
              <label>
                {t("set.providers.baseUrl", { label: p.label })}
                <input
                  type="text"
                  value={config.providers?.[p.id]?.baseUrl ?? ""}
                  onChange={(e) => updateBaseUrl(p.id, e.target.value)}
                  placeholder={meta.defaultBaseUrl}
                />
              </label>
              {!needsKey && <p className="muted">{t("set.prov.hostHint")}</p>}
            </details>
            <div className="provider-card-actions">
              <button type="button" onClick={() => void saveAndTest(p.id)} disabled={testing === p.id}>
                {testing === p.id ? t("set.prov.testing") : t("set.prov.saveTest")}
              </button>
              {justTested[p.id] && !p.error && !testing && <span className="muted">{t("set.prov.nextStep")}</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export { buildProvidersPatch } from "../providersPatch.js";
