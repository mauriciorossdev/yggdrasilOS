import { useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { ConfigGetResult, ConfigShape, ProviderInfo, ProviderSources } from "../types.js";
import { buildProvidersPatch } from "./providersPatch.js";
import { useI18n } from "../i18n/index.js";
import { useKitHost } from "../host.js";
import { Chip } from "../ui/Chip.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  providers: ProviderInfo[];
  apiKeyEdits: Record<string, string>;
  setApiKeyEdits: (edits: Record<string, string>) => void;
  /** Called with the fresh provider list after a card's "Save & test" so the parent's copy (e.g. Agents' model picker) stays current. */
  onProvidersChanged?: (providers: ProviderInfo[]) => void;
  /** Providers as last loaded/saved: a save sends only what changed against these. */
  loadedProviders: ConfigShape["providers"];
  setLoadedProviders: (providers: ConfigShape["providers"]) => void;
  /** Where each field comes from: default, global (~/.yggdrasil/providers.json), this project, or an env var. */
  providerSources: ProviderSources;
  setProviderSources: (sources: ProviderSources) => void;
  /** Providers whose edits save to this project only instead of globally. */
  projectOnly: Record<string, boolean>;
  setProjectOnly: (projectOnly: Record<string, boolean>) => void;
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

export function ProvidersSection({
  config,
  setConfig,
  providers,
  apiKeyEdits,
  setApiKeyEdits,
  onProvidersChanged,
  loadedProviders,
  setLoadedProviders,
  providerSources,
  setProviderSources,
  projectOnly,
  setProjectOnly,
}: Props) {
  const host = useKitHost();
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

  // After a save or a scope change: this provider's persisted fields, its sources and the
  // model list come back fresh; other cards' unsaved edits survive.
  const refresh = async (id: string) => {
    const [list, fresh] = await Promise.all([
      call<{ providers: ProviderInfo[] }>("providers.list"),
      call<ConfigGetResult>("config.get"),
    ]);
    const entry = fresh.config.providers?.[id] ?? {};
    setConfig({ ...config, providers: { ...config.providers, [id]: entry } });
    setLoadedProviders({ ...loadedProviders, [id]: entry });
    setProviderSources(fresh.providerSources ?? {});
    onProvidersChanged?.(list.providers ?? []);
  };

  // Persist just this card's changed fields (globally, unless "only this project" is on),
  // then re-list so the card shows the real outcome (models loaded, or the provider's own
  // error for a bad key/host).
  const saveAndTest = async (id: string) => {
    setTesting(id);
    try {
      const edit = buildProvidersPatch(config, loadedProviders, apiKeyEdits)[id];
      if (edit) {
        await call("config.patch", {
          ...(projectOnly[id] ? { providersScope: "project" } : {}),
          providers: { [id]: edit },
        });
      }
      const { [id]: _saved, ...restEdits } = apiKeyEdits;
      setApiKeyEdits(restEdits);
      await refresh(id);
      setJustTested({ ...justTested, [id]: true });
    } catch {
      // The gateway call itself failed; the card keeps its previous status.
    } finally {
      setTesting(null);
    }
  };

  // "Move to global" / "Use global" for a provider this project overrides.
  const scope = async (id: string, action: "moveToGlobal" | "useGlobal") => {
    setTesting(id);
    try {
      await call("providers.scope", { id, action });
      await refresh(id);
    } catch {
      // Keeps the card as it was.
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
            {(() => {
              const sources = providerSources[p.id] ?? {};
              const own = (["baseUrl", "apiKey", "defaultModel"] as const).filter((f) => sources[f] === "project");
              return own.length > 0 ? (
                <div className="provider-scope provider-scope--project">
                  <span>{t("set.prov.scopeProject", { fields: own.map((f) => t(`set.prov.field.${f}`)).join(", ") })}</span>
                  <button type="button" onClick={() => void scope(p.id, "moveToGlobal")} disabled={testing === p.id}>
                    {t("set.prov.moveToGlobal")}
                  </button>
                  <button type="button" onClick={() => void scope(p.id, "useGlobal")} disabled={testing === p.id}>
                    {t("set.prov.useGlobal")}
                  </button>
                </div>
              ) : (
                <p className="muted provider-scope">{t("set.prov.scopeGlobal")}</p>
              );
            })()}
            {providerSources[p.id]?.apiKey === "env" && <p className="muted">{t("set.prov.keyFromEnv")}</p>}
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
                    onClick={() => host.openExternal?.(meta.keyUrl!)}
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
            <label className="provider-project-only">
              <input
                type="checkbox"
                checked={Boolean(projectOnly[p.id])}
                onChange={(e) => setProjectOnly({ ...projectOnly, [p.id]: e.target.checked })}
              />
              {t("set.prov.projectOnly")}
            </label>
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
