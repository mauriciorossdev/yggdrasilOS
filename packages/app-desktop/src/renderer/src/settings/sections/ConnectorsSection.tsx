import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { GithubConnector } from "./GithubConnector.js";

type GoogleStatus = { connected: boolean; scopes?: string[]; connectedAt?: number };

// Own load/connect cycle, same reasoning as PairedDevicesSection — this is
// an immediate action (opens a browser, waits for a redirect back into this
// app), not something to queue behind SettingsView's batched "Save
// settings" button.
export function ConnectorsSection() {
  const { call } = useGateway();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      const res = await call<GoogleStatus>("connectors.google.status");
      setStatus(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only registered while actually waiting on a callback — the browser
  // redirect (main/index.ts's open-url/second-instance handler) broadcasts
  // to every open project window, since each window's own gateway process
  // holds the pending-state map that decides which one it actually belongs
  // to (see main/index.ts's broadcastOAuthCallback comment).
  useEffect(() => {
    if (!connecting) return;
    return window.yggdrasil.connectors.onOAuthCallback(({ code, state }) => {
      void (async () => {
        try {
          await call("connectors.google.completeAuth", { code, state });
          setError(null);
          await loadStatus();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setConnecting(false);
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connecting, call]);

  const connect = async () => {
    setError(null);
    try {
      const { authUrl } = await call<{ authUrl: string }>("connectors.google.authUrl");
      setConnecting(true);
      window.open(authUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="settings-section">
      <h3>Connectors</h3>
      <p className="muted">
        Connect your Google account to enable Calendar, Gmail, and sharing notes to Drive, and your GitHub account to browse and clone repositories. Consent opens in
        your system browser — come back to this window once you approve it.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="settings-provider">
        <div className="mcp-server-header">
          <strong>Google</strong>
          <button type="button" className="icon-btn" onClick={() => void connect()} disabled={connecting}>
            {connecting ? "Waiting…" : status?.connected ? "Reconnect" : "Connect"}
          </button>
        </div>
        <p className="muted">
          {status === null && "Loading…"}
          {status && !status.connected && "Not connected."}
          {status?.connected &&
            `Connected${status.connectedAt ? ` since ${new Date(status.connectedAt).toLocaleDateString()}` : ""} · scopes: ${(status.scopes ?? []).join(", ") || "—"}`}
        </p>
      </div>

      <GithubConnector />
    </section>
  );
}
