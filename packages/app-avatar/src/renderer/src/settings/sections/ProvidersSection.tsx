import type { ConfigShape, ProviderInfo } from "../../types.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  providers: ProviderInfo[];
  apiKeyEdits: Record<string, string>;
  setApiKeyEdits: (edits: Record<string, string>) => void;
};

// Real default base URL per provider (see packages/provider-*/src/provider.ts's
// DEFAULT_BASE_URL) — shown as a placeholder so an empty field's implied
// behavior is clear.
const DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: "http://127.0.0.1:11434",
  "openai-compat": "https://api.openai.com/v1",
};
const PROVIDERS_WITH_API_KEY = new Set(["openai-compat"]);

export function ProvidersSection({ config, setConfig, providers, apiKeyEdits, setApiKeyEdits }: Props) {
  const updateBaseUrl = (id: string, baseUrl: string) => {
    setConfig({
      ...config,
      providers: { ...config.providers, [id]: { ...config.providers?.[id], baseUrl: baseUrl || undefined } },
    });
  };

  return (
    <section className="settings-section">
      <h3>Providers</h3>
      <p className="muted">
        Point a provider at any host — local Ollama, Ollama Cloud, OpenAI, or any OpenAI-chat-completions-compatible
        endpoint (e.g. a Claude-compatible proxy) — as <code>http://&lt;host&gt;:&lt;port&gt;</code> or a full URL.
      </p>
      {providers.map((p) => (
        <div key={p.id} className="settings-provider">
          <label>
            {p.label} base URL
            <input
              type="text"
              value={config.providers?.[p.id]?.baseUrl ?? ""}
              onChange={(e) => updateBaseUrl(p.id, e.target.value)}
              placeholder={DEFAULT_BASE_URLS[p.id] ?? "https://…"}
            />
          </label>
          {p.error && (
            <p className="provider-warning">
              ⚠ Unreachable — {p.error}. Model list unavailable; double-check the URL and that the host is reachable.
            </p>
          )}
          {PROVIDERS_WITH_API_KEY.has(p.id) && (
            <label>
              {p.label} API key
              <input
                type="password"
                value={apiKeyEdits[p.id] ?? ""}
                onChange={(e) => setApiKeyEdits({ ...apiKeyEdits, [p.id]: e.target.value })}
                placeholder="Leave blank to keep the current key"
                autoComplete="off"
              />
            </label>
          )}
        </div>
      ))}
    </section>
  );
}

/** Fold session-only API key edits into the providers object SettingsView.save() sends in its config.patch. */
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
