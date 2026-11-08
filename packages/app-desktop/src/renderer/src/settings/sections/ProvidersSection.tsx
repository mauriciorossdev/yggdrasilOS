import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import type { ConfigShape, ProviderInfo } from "../../types.js";
import { useI18n } from "../../i18n/index.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  providers: ProviderInfo[];
  apiKeyEdits: Record<string, string>;
  setApiKeyEdits: (edits: Record<string, string>) => void;
};

// Providers that take an API key, and each provider's real default base URL
// (see packages/provider-*/src/provider.ts's DEFAULT_BASE_URL) — shown as a
// placeholder so an empty field's implied behavior is clear.
const DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: "http://127.0.0.1:11434",
  "openai-compat": "https://api.openai.com/v1",
};
const PROVIDERS_WITH_API_KEY = new Set(["openai-compat"]);

export function ProvidersSection({ config, setConfig, providers, apiKeyEdits, setApiKeyEdits }: Props) {
  const { t } = useI18n();
  const updateBaseUrl = (id: string, baseUrl: string) => {
    setConfig({
      ...config,
      providers: { ...config.providers, [id]: { ...config.providers?.[id], baseUrl: baseUrl || undefined } },
    });
  };

  return (
    <section className="settings-section">
      <h3>{t("set.providers.title")}</h3>
      <p className="muted">
        {t("set.providers.introBefore")}{" "}
        <code>http://&lt;ip&gt;:&lt;port&gt;</code>.
      </p>
      {providers.map((p) => (
        <div key={p.id} className="settings-provider">
          <label>
            {t("set.providers.baseUrl", { label: p.label })}
            <input
              type="text"
              value={config.providers?.[p.id]?.baseUrl ?? ""}
              onChange={(e) => updateBaseUrl(p.id, e.target.value)}
              placeholder={DEFAULT_BASE_URLS[p.id] ?? "https://…"}
            />
          </label>
          {p.error && (
            <p className="provider-warning">
              <ExclamationTriangleIcon className="hero-icon" /> {t("set.providers.unreachable", { error: p.error })}
            </p>
          )}
          {PROVIDERS_WITH_API_KEY.has(p.id) && (
            <label>
              {t("set.providers.apiKey", { label: p.label })}
              <input
                type="password"
                value={apiKeyEdits[p.id] ?? ""}
                onChange={(e) => setApiKeyEdits({ ...apiKeyEdits, [p.id]: e.target.value })}
                placeholder={t("set.providers.apiKeyPlaceholder")}
                autoComplete="off"
              />
            </label>
          )}
        </div>
      ))}
    </section>
  );
}

/** Fold session-only API key edits (write-only fields, never pre-filled from the masked config.get value) into the providers object SettingsView.save() sends in its config.patch. */
export function buildProvidersPatch(
  config: ConfigShape,
  apiKeyEdits: Record<string, string>,
): ConfigShape["providers"] {
  const providers: NonNullable<ConfigShape["providers"]> = { ...config.providers };
  for (const [id, key] of Object.entries(apiKeyEdits)) {
    if (!key) continue;
    providers[id] = { ...providers[id], apiKey: key };
  }
  return providers;
}
