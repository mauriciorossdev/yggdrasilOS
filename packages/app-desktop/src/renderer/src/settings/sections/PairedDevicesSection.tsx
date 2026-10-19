import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";

type ApiKeyEntry = {
  name: string;
  expiresAt?: number;
  keyPreview?: string;
};

// Own fetch/revoke cycle, separate from SettingsView's batched config.patch
// save flow — revoking is immediate and destructive (kills that device's
// connection right away), not something to queue behind "Save settings".
export function PairedDevicesSection() {
  const { call } = useGateway();
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await call<{ apiKeys: ApiKeyEntry[] }>("auth.apiKeys.list");
      setApiKeys(result.apiKeys ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revoke = async (name: string) => {
    if (
      !window.confirm(
        `Revoke "${name}"? That device will be disconnected immediately and can't reconnect until a new key is issued for it.`,
      )
    ) {
      return;
    }
    setRevoking(name);
    setError(null);
    try {
      await call("auth.apiKeys.revoke", { name });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <section className="settings-section">
      <h3>Paired devices</h3>
      <p className="muted">
        Devices (phone, other clients) holding a named API key for this gateway. Revoking one takes effect
        immediately. There's no "add device" flow here yet — issuing a new key still means adding one to
        auth.gateway.apiKeys in yggdrasil.config.json by hand.
      </p>

      {error && <p className="error">{error}</p>}
      {apiKeys === null && !error && <p className="muted">Loading…</p>}
      {apiKeys?.length === 0 && <p className="muted">No paired devices.</p>}

      {apiKeys?.map((k) => (
        <div key={k.name} className="settings-provider">
          <div className="mcp-server-header">
            <strong>{k.name}</strong>
            <button
              type="button"
              className="icon-btn"
              onClick={() => void revoke(k.name)}
              disabled={revoking === k.name}
              title={`Revoke ${k.name}`}
            >
              {revoking === k.name ? "Revoking…" : "Revoke"}
            </button>
          </div>
          <p className="muted">
            Key ending in <code>{k.keyPreview ?? "····"}</code>
            {" · "}
            {k.expiresAt ? `expires ${new Date(k.expiresAt).toLocaleDateString()}` : "never expires"}
          </p>
        </div>
      ))}
    </section>
  );
}
