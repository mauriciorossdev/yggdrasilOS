import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { useI18n } from "../../i18n/index.js";
import { GithubConnector } from "./GithubConnector.js";

type GoogleStatus = { connected: boolean; scopes?: string[]; connectedAt?: number };

// Own load/connect cycle, same reasoning as PairedDevicesSection — this is
// an immediate action (opens a browser, waits for a redirect back into this
// app), not something to queue behind SettingsView's batched "Save
// settings" button.
export function ConnectorsSection() {
  const { t } = useI18n();
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
      <h3>{t("set.connectors.title")}</h3>
      <p className="muted">
        {t("set.connectors.intro")}
      </p>

      {error && <p className="error">{error}</p>}

      <div className="settings-provider">
        <div className="mcp-server-header">
          <strong>Google</strong>
          <button type="button" className="icon-btn" onClick={() => void connect()} disabled={connecting}>
            {connecting ? t("set.connectors.waiting") : status?.connected ? t("set.connectors.reconnect") : t("set.connectors.connect")}
          </button>
        </div>
        <p className="muted">
          {status === null && t("set.connectors.loading")}
          {status && !status.connected && t("set.connectors.notConnected")}
          {status?.connected &&
            t("set.connectors.googleStatus", {
              since: status.connectedAt
                ? t("set.connectors.since", { date: new Date(status.connectedAt).toLocaleDateString() })
                : "",
              scopes: (status.scopes ?? []).join(", ") || "—",
            })}
        </p>
      </div>

      <GithubConnector />
    </section>
  );
}
