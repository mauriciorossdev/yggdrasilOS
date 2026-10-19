import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import type { ConfigShape, ProviderInfo } from "../../types.js";

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
        Point a provider at a remote host instead of the default — e.g. an Ollama instance running on another
        machine on your network (same idea as Ollama's own network mode): enter its address as{" "}
        <code>http://&lt;ip&gt;:&lt;port&gt;</code>.
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
              <ExclamationTriangleIcon className="hero-icon" /> Unreachable — {p.error}. Model list unavailable;
              double-check the URL and that the host is reachable.
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
