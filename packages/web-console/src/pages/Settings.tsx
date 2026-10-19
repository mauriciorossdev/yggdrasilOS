import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";

type Agent = { id: string; label?: string; provider?: string; model?: string };
type Harness = { id: string; label: string };
type ConfigShape = {
  agents?: Agent[];
  defaultAgent?: string;
  harness?: { policy?: string; pinnedId?: string };
  channels?: Record<string, { enabled?: boolean }>;
};

export function SettingsPage() {
  const { call, connected } = useGateway();
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [harnesses, setHarnesses] = useState<Harness[]>([]);
  const [providers, setProviders] = useState<Array<{ id: string; models: string[] }>>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    void (async () => {
      try {
        const [cfg, h, p] = await Promise.all([
          call<{ config: ConfigShape }>("config.get"),
          call<{ harnesses: Harness[] }>("harnesses.list"),
          call<{ providers: Array<{ id: string; models: string[] }> }>("providers.list"),
        ]);
        setConfig(cfg.config);
        setHarnesses(h.harnesses ?? []);
        setProviders(
          (p.providers ?? []).map((pr) => ({
            id: pr.id,
            models: Array.isArray(pr.models)
              ? pr.models.map((m) => (typeof m === "string" ? m : (m as { id: string }).id))
              : [],
          })),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [call, connected]);

  if (error) return <p className="error">{error}</p>;
  if (!config) return <p className="muted">Cargando…</p>;

  const defaultAgent = config.agents?.find((a) => a.id === config.defaultAgent) ?? config.agents?.[0];

  const updateAgent = (field: keyof Agent, value: string) => {
    if (!defaultAgent) return;
    const agents = (config.agents ?? []).map((a) =>
      a.id === defaultAgent.id ? { ...a, [field]: value } : a,
    );
    setConfig({ ...config, agents });
  };

  const toggleChannel = (id: string, enabled: boolean) => {
    setConfig({
      ...config,
      channels: {
        ...config.channels,
        [id]: { ...config.channels?.[id], enabled },
      },
    });
  };

  const save = async () => {
    setSaved(false);
    try {
      const res = await call<{ requiresRestart: boolean }>("config.patch", {
        agents: config.agents,
        defaultAgent: config.defaultAgent,
        harness: config.harness,
        channels: config.channels,
      });
      setSaved(true);
      if (res.requiresRestart) {
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="page">
      <h1>Settings</h1>
      {saved && (
        <p className="banner">Guardado. Reinicia el gateway para aplicar cambios de harness/canales.</p>
      )}

      <section className="card form-section">
        <h2>Agente</h2>
        <label>
          Default agent
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
          Provider
          <select
            value={defaultAgent?.provider ?? ""}
            onChange={(e) => updateAgent("provider", e.target.value)}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
            <option value="builtin">builtin</option>
          </select>
        </label>
        <label>
          Model
          <input
            value={defaultAgent?.model ?? ""}
            onChange={(e) => updateAgent("model", e.target.value)}
            list="model-suggestions"
          />
          <datalist id="model-suggestions">
            {providers
              .find((p) => p.id === defaultAgent?.provider)
              ?.models.map((m) => (
                <option key={m} value={m} />
              ))}
          </datalist>
        </label>
      </section>

      <section className="card form-section">
        <h2>Harness</h2>
        <label>
          Policy
          <select
            value={config.harness?.policy ?? "auto"}
            onChange={(e) =>
              setConfig({ ...config, harness: { ...config.harness, policy: e.target.value } })
            }
          >
            <option value="auto">auto</option>
            <option value="pinned">pinned</option>
          </select>
        </label>
        {config.harness?.policy === "pinned" && (
          <label>
            Pinned harness
            <select
              value={config.harness?.pinnedId ?? ""}
              onChange={(e) =>
                setConfig({ ...config, harness: { ...config.harness, pinnedId: e.target.value } })
              }
            >
              {harnesses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="card form-section">
        <h2>Canales</h2>
        {Object.entries(config.channels ?? {}).map(([id, ch]) => (
          <label key={id} className="checkbox-row">
            <input
              type="checkbox"
              checked={ch.enabled !== false}
              onChange={(e) => toggleChannel(id, e.target.checked)}
            />
            {id}
          </label>
        ))}
      </section>

      <button type="button" onClick={() => void save()}>
        Guardar configuración
      </button>
    </div>
  );
}
