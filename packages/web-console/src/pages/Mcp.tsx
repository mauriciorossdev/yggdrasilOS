import { useCallback, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { Chip } from "@yggdrasil/ui-kit";
import { useT } from "../i18n";

type Server = { id: string; state: "connecting" | "connected" | "error" | "stopped"; connected: boolean; toolCount: number; tools: string[]; autoStart: boolean; error?: string };

const TONE = { connected: "ready", connecting: "working", error: "danger", stopped: "neutral" } as const;

/** MCP servers of this project: state, tools, reconnect/disconnect. Adding or editing them stays in the app. */
export function McpPage() {
  const { call, connected } = useGateway();
  const t = useT();
  const [servers, setServers] = useState<Server[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setServers((await call<{ servers: Server[] }>("mcp.status")).servers ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setServers([]);
    }
  }, [call]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  const act = async (id: string, method: "mcp.reconnect" | "mcp.disconnect") => {
    setBusy(id);
    try {
      setServers((await call<{ servers: Server[] }>(method, { serverId: id }, { timeoutMs: 60_000 })).servers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <h1>MCP</h1>
      {error && <p className="error">{error}</p>}
      {servers === null ? (
        <p className="muted">{t("common.loading")}</p>
      ) : servers.length === 0 ? (
        <p className="muted">{t("overview.noMcp")}</p>
      ) : (
        <ul className="card-list">
          {servers.map((s) => (
            <li key={s.id} className="card">
              <div className="row">
                <strong className="grow">{s.id}</strong>
                <Chip tone={TONE[s.state]}>{t(`mcp.state.${s.state}`)}</Chip>
                {s.state === "connected" ? (
                  <button type="button" className="secondary" disabled={busy === s.id} onClick={() => void act(s.id, "mcp.disconnect")}>
                    {t("mcp.disconnect")}
                  </button>
                ) : (
                  <button type="button" disabled={busy === s.id} onClick={() => void act(s.id, "mcp.reconnect")}>
                    {busy === s.id ? t("mcp.connecting") : t("mcp.connect")}
                  </button>
                )}
              </div>
              {s.error && <p className="error">{s.error}</p>}
              {s.tools.length > 0 && (
                <details>
                  <summary className="muted">{t("overview.tools", { count: s.toolCount })}</summary>
                  <p className="tool-names">{s.tools.join(", ")}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
