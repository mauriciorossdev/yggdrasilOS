import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";

export function OverviewPage() {
  const { call, connected } = useGateway();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    void (async () => {
      try {
        const [health, plugins, harnesses, providers, channels] = await Promise.all([
          call("health"),
          call("plugins.list"),
          call("harnesses.list"),
          call("providers.list"),
          call("channels.status"),
        ]);
        setData({ health, plugins, harnesses, providers, channels });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [call, connected]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Cargando…</p>;

  return (
    <div className="page">
      <h1>Overview</h1>
      <div className="grid">
        <section className="card">
          <h2>Health</h2>
          <pre>{JSON.stringify(data.health, null, 2)}</pre>
        </section>
        <section className="card">
          <h2>Plugins</h2>
          <pre>{JSON.stringify(data.plugins, null, 2)}</pre>
        </section>
        <section className="card">
          <h2>Harnesses</h2>
          <pre>{JSON.stringify(data.harnesses, null, 2)}</pre>
        </section>
        <section className="card">
          <h2>Providers</h2>
          <pre>{JSON.stringify(data.providers, null, 2)}</pre>
        </section>
        <section className="card">
          <h2>Channels</h2>
          <pre>{JSON.stringify(data.channels, null, 2)}</pre>
        </section>
      </div>
    </div>
  );
}
