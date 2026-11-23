import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useGateway } from "@yggdrasil/client-web";
import { Card, Chip, type AgentInfo, type ProviderInfo } from "@yggdrasil/ui-kit";
import { useT } from "../i18n";

type Health = { ok: boolean; version?: string; uptime?: number; authRequired?: boolean; keyConfigured?: boolean };
type McpServer = { id: string; state?: string; connected: boolean; toolCount: number; error?: string };
type Plugin = { id: string; name: string; version: string };

function uptimeText(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** At a glance: is the gateway fine, which agent answers, which providers and MCP servers work. */
export function OverviewPage() {
  const { call, connected } = useGateway();
  const t = useT();
  const [health, setHealth] = useState<Health | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [agents, setAgents] = useState<{ agents: AgentInfo[]; defaultAgent: string } | null>(null);
  const [mcp, setMcp] = useState<McpServer[] | null>(null);
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);

  useEffect(() => {
    if (!connected) return;
    void call<Health>("health").then(setHealth).catch(() => undefined);
    void call<{ providers: ProviderInfo[] }>("providers.list").then((r) => setProviders(r.providers ?? [])).catch(() => setProviders([]));
    void call<{ agents: AgentInfo[]; defaultAgent: string }>("agents.list").then(setAgents).catch(() => undefined);
    void call<{ servers: McpServer[] }>("mcp.status").then((r) => setMcp(r.servers ?? [])).catch(() => setMcp([]));
    void call<{ plugins: Plugin[] }>("plugins.list").then((r) => setPlugins(r.plugins ?? [])).catch(() => setPlugins([]));
  }, [connected, call]);

  const defaultAgent = agents?.agents.find((a) => a.id === agents.defaultAgent);

  return (
    <div className="page">
      <h1>{t("nav.overview")}</h1>
      <div className="grid">
        <Card>
          <h3>{t("overview.gateway")}</h3>
          <p>
            <Chip tone={health?.ok ? "ready" : "danger"}>{health?.ok ? t("overview.ok") : t("overview.down")}</Chip>
          </p>
          <dl className="facts">
            <dt>{t("overview.version")}</dt>
            <dd>{health?.version ?? "—"}</dd>
            <dt>{t("overview.uptime")}</dt>
            <dd>{uptimeText(health?.uptime)}</dd>
            <dt>{t("overview.key")}</dt>
            <dd>{health?.keyConfigured ? t("overview.keyYes") : t("overview.keyNo")}</dd>
          </dl>
        </Card>

        <Card>
          <h3>{t("overview.defaultAgent")}</h3>
          {defaultAgent ? (
            <>
              <p className="big">{defaultAgent.label ?? defaultAgent.id}</p>
              <p className="muted">
                {defaultAgent.provider || defaultAgent.model
                  ? `${defaultAgent.provider ?? "?"} / ${defaultAgent.model ?? "?"}`
                  : (defaultAgent.harness ?? "—")}
              </p>
              <p className="muted">{t("overview.agentsCount", { count: agents?.agents.length ?? 0 })}</p>
            </>
          ) : (
            <p className="muted">—</p>
          )}
          <Link className="link-btn" to="/agents">
            {t("nav.agents")} →
          </Link>
        </Card>

        <Card>
          <h3>{t("nav.providers")}</h3>
          <ul className="status-list">
            {(providers ?? []).map((p) => (
              <li key={p.id}>
                <span>{p.label}</span>
                {p.error ? (
                  <Chip tone="danger">{t("overview.error")}</Chip>
                ) : p.needsKey && !p.configured ? (
                  <Chip tone="neutral">{t("overview.noKey")}</Chip>
                ) : (
                  <Chip tone="ready">{t("overview.models", { count: p.models.length })}</Chip>
                )}
              </li>
            ))}
          </ul>
          <Link className="link-btn" to="/providers">
            {t("nav.providers")} →
          </Link>
        </Card>

        <Card>
          <h3>MCP</h3>
          {mcp && mcp.length === 0 ? (
            <p className="muted">{t("overview.noMcp")}</p>
          ) : (
            <ul className="status-list">
              {(mcp ?? []).map((s) => (
                <li key={s.id} title={s.error}>
                  <span>{s.id}</span>
                  {s.connected ? (
                    <Chip tone="ready">{t("overview.tools", { count: s.toolCount })}</Chip>
                  ) : (
                    <Chip tone={s.error ? "danger" : "neutral"}>{s.error ? t("overview.error") : t("overview.off")}</Chip>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3>{t("overview.plugins")}</h3>
          <p className="muted">{t("overview.pluginsCount", { count: plugins?.length ?? 0 })}</p>
          <ul className="plain-list">
            {(plugins ?? []).map((p) => (
              <li key={p.id}>
                {p.name} <span className="muted">{p.version}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
