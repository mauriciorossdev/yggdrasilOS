import { useState } from "react";
import { API_KEY_STORAGE, useGateway } from "@yggdrasil/client-web";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { health, authenticated, connect } = useGateway();
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem(API_KEY_STORAGE) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (health && !health.authRequired) {
    return <>{children}</>;
  }

  if (authenticated) {
    return <>{children}</>;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await connect(apiKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // From another device a key is always required; a gateway with none configured can't be
  // reached until one exists (notes/features/web-console-upgrade.md, "Seguridad").
  if (health && health.keyConfigured === false) {
    return (
      <div className="auth-gate">
        <div className="card auth-card">
          <h1>Yggdrasil Console</h1>
          <p className="muted">
            Este gateway solo acepta otros dispositivos con una API key, y no tiene ninguna. Vincula este dispositivo desde
            la app (Ajustes → Dispositivos vinculados) o configura <code>auth.gateway.apiKey</code>, y vuelve a entrar con
            esa key. Desde el mismo computador la consola entra sin key.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-gate">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Yggdrasil Console</h1>
        <p className="muted">API key requerida para el gateway WebSocket.</p>
        <label>
          API key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="YGGDRASIL_API_KEY"
            autoComplete="off"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading || !apiKey.trim()}>
          {loading ? "Conectando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
