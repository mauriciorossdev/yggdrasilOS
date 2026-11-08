import { useState } from "react";
import { CheckIcon, ChevronRightIcon, ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useI18n, type MessageKey } from "../../i18n/index.js";
import { Chip } from "../../ui/Chip.js";
import type { ConfigMcpServer, ConfigShape, McpServerStatus, McpTestResult } from "../../types.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  mcpStatus: McpServerStatus[];
  onMcpAction: (method: "mcp.reconnect" | "mcp.disconnect", serverId: string) => void;
  /** Tries the server as it is in the form, without saving it. */
  onMcpTest: (serverId: string) => Promise<McpTestResult>;
  mcpSecretEdits: Record<string, string>;
  setMcpSecretEdits: (edits: Record<string, string>) => void;
};

function newServerId(existing: Record<string, ConfigMcpServer>): string {
  let n = 1;
  while (existing[`server-${n}`]) n++;
  return `server-${n}`;
}

const IMPORT_PLACEHOLDER = `{
  "mcpServers": {
    "blender": {
      "command": "uvx",
      "args": ["blender-mcp"]
    }
  }
}`;

type ParsedMcpServer = {
  id: string;
  server: ConfigMcpServer;
  secrets?: Record<string, string>;
};

// Accepts the same shape every other MCP client (Claude Desktop, Cursor, …)
// uses for its config file — either the full `{ "mcpServers": {...} }` block
// or just the bare id-keyed map — so a snippet copied from a server's README
// works unmodified. There's no "transport" field in that convention; it's
// inferred the same way those clients infer it: "command" present → stdio,
// "url" present → http.
function parseMcpServersJson(
  raw: string,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): ParsedMcpServer[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(t("set.mcp.invalidJson"));
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(t("set.mcp.expectedObject"));
  }

  const wrapped = (data as Record<string, unknown>).mcpServers;
  const map = wrapped !== undefined ? wrapped : data;
  if (typeof map !== "object" || map === null || Array.isArray(map)) {
    throw new Error(t("set.mcp.expectedEntries"));
  }

  const results: ParsedMcpServer[] = [];
  for (const [id, value] of Object.entries(map as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      throw new Error(t("set.mcp.entryExpectedObject", { id }));
    }
    const entry = value as Record<string, unknown>;

    if (typeof entry.command === "string") {
      const secrets =
        entry.env && typeof entry.env === "object"
          ? Object.fromEntries(Object.entries(entry.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
          : undefined;
      results.push({
        id,
        server: {
          transport: "stdio",
          command: entry.command,
          args: Array.isArray(entry.args) ? entry.args.map(String) : undefined,
        },
        secrets,
      });
    } else if (typeof entry.url === "string") {
      const secrets =
        entry.headers && typeof entry.headers === "object"
          ? Object.fromEntries(
              Object.entries(entry.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
            )
          : undefined;
      results.push({ id, server: { transport: "http", url: entry.url }, secrets });
    } else {
      throw new Error(t("set.mcp.entryNeedsCommandOrUrl", { id }));
    }
  }

  if (results.length === 0) {
    throw new Error(t("set.mcp.noEntries"));
  }
  return results;
}

export function McpSection({ config, setConfig, mcpStatus, onMcpAction, onMcpTest, mcpSecretEdits, setMcpSecretEdits }: Props) {
  const { t } = useI18n();
  const servers = config.mcpServers ?? {};
  const entries = Object.entries(servers);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  // Cards start collapsed; new and imported servers open so they can be filled in.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tests, setTests] = useState<Record<string, { testing: true } | { testing: false; result: McpTestResult }>>({});

  const toggle = (id: string) => setOpen((cur) => ({ ...cur, [id]: !cur[id] }));
  const setAllOpen = (value: boolean) => setOpen(Object.fromEntries(Object.keys(servers).map((id) => [id, value])));
  const clearTest = (id: string) =>
    setTests((cur) => {
      if (!(id in cur)) return cur;
      const { [id]: _drop, ...rest } = cur;
      return rest;
    });

  const runTest = async (id: string) => {
    setTests((cur) => ({ ...cur, [id]: { testing: true } }));
    let result: McpTestResult;
    try {
      result = await onMcpTest(id);
    } catch (err) {
      result = { ok: false, toolCount: 0, tools: [], durationMs: 0, error: err instanceof Error ? err.message : String(err) };
    }
    setTests((cur) => ({ ...cur, [id]: { testing: false, result } }));
  };

  const updateServer = (id: string, next: ConfigMcpServer) => {
    setConfig({ ...config, mcpServers: { ...servers, [id]: next } });
    clearTest(id);
  };

  const editSecrets = (id: string, value: string) => {
    setMcpSecretEdits({ ...mcpSecretEdits, [id]: value });
    clearTest(id);
  };

  const renameServer = (oldId: string, newId: string) => {
    if (!newId || newId === oldId || servers[newId]) return;
    const rest = { ...servers };
    const entry = rest[oldId];
    delete rest[oldId];
    setConfig({ ...config, mcpServers: { ...rest, [newId]: entry } });
    setOpen((cur) => {
      const { [oldId]: was, ...others } = cur;
      return { ...others, [newId]: was ?? false };
    });
    clearTest(oldId);
    if (mcpSecretEdits[oldId] !== undefined) {
      const restSecrets = { ...mcpSecretEdits };
      const secret = restSecrets[oldId];
      delete restSecrets[oldId];
      setMcpSecretEdits({ ...restSecrets, [newId]: secret });
    }
  };

  const removeServer = (id: string) => {
    const rest = { ...servers };
    delete rest[id];
    setConfig({ ...config, mcpServers: rest });
    if (mcpSecretEdits[id] !== undefined) {
      const restSecrets = { ...mcpSecretEdits };
      delete restSecrets[id];
      setMcpSecretEdits(restSecrets);
    }
  };

  const addServer = () => {
    const id = newServerId(servers);
    setConfig({ ...config, mcpServers: { ...servers, [id]: { transport: "stdio", command: "", args: [] } } });
    setOpen((cur) => ({ ...cur, [id]: true }));
  };

  const applyImport = () => {
    let parsed: ParsedMcpServer[];
    try {
      parsed = parseMcpServersJson(importText, t);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
      return;
    }

    const nextServers = { ...servers };
    const nextSecrets = { ...mcpSecretEdits };
    for (const { id, server, secrets } of parsed) {
      nextServers[id] = server;
      if (secrets) {
        nextSecrets[id] = Object.entries(secrets)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n");
      }
    }
    setConfig({ ...config, mcpServers: nextServers });
    setMcpSecretEdits(nextSecrets);
    setOpen((cur) => ({ ...cur, ...Object.fromEntries(parsed.map((p) => [p.id, true])) }));
    setImportText("");
    setImportError(null);
    setShowImport(false);
  };

  return (
    <section className="settings-section">
      <h3>{t("set.mcp.title")}</h3>
      <p className="muted">
        {t("set.mcp.intro")}
      </p>
      {showImport ? (
        <div className="mcp-import">
          <label>
            {t("set.mcp.pasteJson")}
            <textarea
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportError(null);
              }}
              placeholder={IMPORT_PLACEHOLDER}
              rows={8}
              autoFocus
            />
          </label>
          {importError && <p className="error">{importError}</p>}
          <div className="agent-form-actions">
            <button
              type="button"
              onClick={() => {
                setShowImport(false);
                setImportText("");
                setImportError(null);
              }}
            >
              {t("set.mcp.cancel")}
            </button>
            <button type="button" onClick={applyImport} disabled={!importText.trim()}>
              {t("set.mcp.import")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mcp-add-actions">
          <button type="button" className="new-chat" onClick={addServer}>
            {t("set.mcp.addServer")}
          </button>
          <button type="button" className="new-chat" onClick={() => setShowImport(true)}>
            {t("set.mcp.importJson")}
          </button>
          {entries.length > 1 && (
            <>
              <button type="button" className="mcp-small-btn" onClick={() => setAllOpen(true)}>
                {t("set.mcp.expandAll")}
              </button>
              <button type="button" className="mcp-small-btn" onClick={() => setAllOpen(false)}>
                {t("set.mcp.collapseAll")}
              </button>
            </>
          )}
        </div>
      )}
      {entries.map(([id, server]) => {
        const status = mcpStatus.find((s) => s.id === id);
        const isOpen = open[id] === true;
        const test = tests[id];
        const chip = !status
          ? null
          : status.connected
            ? {
                tone: "ready" as const,
                text: status.toolCount === 1 ? t("set.mcp.toolsOne") : t("set.mcp.toolsMany", { count: status.toolCount }),
              }
            : status.state === "connecting"
              ? { tone: "working" as const, text: t("set.mcp.connecting") }
              : status.state === "stopped"
                ? { tone: "neutral" as const, text: t("set.mcp.notConnected") }
                : { tone: "danger" as const, text: t("set.mcp.error") };
        const target = server.transport === "stdio" ? [server.command, ...(server.args ?? [])].join(" ").trim() : (server.url ?? "").trim();
        const canTest = target !== "" && (server.transport === "stdio" ? (server.command ?? "").trim() !== "" : true);
        return (
          <div key={id} className="mcp-card">
            <div className="mcp-server-header">
              <button
                type="button"
                className="icon-btn mcp-chevron"
                aria-expanded={isOpen}
                aria-label={isOpen ? t("set.mcp.collapse") : t("set.mcp.expand")}
                title={isOpen ? t("set.mcp.collapse") : t("set.mcp.expand")}
                onClick={() => toggle(id)}
              >
                <ChevronRightIcon className={`hero-icon${isOpen ? " open" : ""}`} />
              </button>
              <input
                type="text"
                value={id}
                onChange={(e) => renameServer(id, e.target.value.trim())}
                className="mcp-id-input"
                aria-label={t("set.mcp.serverName")}
              />
              {chip && (
                <Chip tone={chip.tone} dot title={status?.error ?? undefined}>
                  {chip.text}
                </Chip>
              )}
              {status && (
                <button
                  type="button"
                  className="mcp-small-btn"
                  disabled={status.state === "connecting"}
                  onClick={() => onMcpAction("mcp.reconnect", id)}
                >
                  {status.connected ? t("set.mcp.reconnect") : t("set.mcp.connect")}
                </button>
              )}
              {status?.connected && (
                <button type="button" className="mcp-small-btn" onClick={() => onMcpAction("mcp.disconnect", id)}>
                  {t("set.mcp.disconnect")}
                </button>
              )}
              <button type="button" className="icon-btn" onClick={() => removeServer(id)} title={t("set.mcp.removeServer")}>
                <XMarkIcon className="hero-icon" />
              </button>
            </div>

            {!isOpen && (
              <button type="button" className="mcp-summary" onClick={() => toggle(id)} title={target || undefined}>
                <span className="mcp-summary-kind">{server.transport}</span>
                {target || t("set.mcp.noConfig")}
              </button>
            )}

            {isOpen && (
              <>
                <div className="mcp-grid">
                  <label>
                    {t("set.mcp.transport")}
                    <select
                      value={server.transport}
                      onChange={(e) =>
                        updateServer(
                          id,
                          e.target.value === "stdio"
                            ? { transport: "stdio", command: "", args: [], autoStart: server.autoStart }
                            : { transport: "http", url: "", autoStart: server.autoStart },
                        )
                      }
                    >
                      <option value="stdio">{t("set.mcp.stdioOption")}</option>
                      <option value="http">{t("set.mcp.httpOption")}</option>
                    </select>
                  </label>

                  {server.transport === "stdio" ? (
                    <>
                      <label>
                        {t("set.mcp.command")}
                        <input
                          type="text"
                          value={server.command ?? ""}
                          onChange={(e) => updateServer(id, { ...server, command: e.target.value })}
                          placeholder="npx"
                        />
                      </label>
                      <label className="mcp-grid-wide">
                        {t("set.mcp.args")}
                        <input
                          type="text"
                          value={(server.args ?? []).join(" ")}
                          onChange={(e) =>
                            updateServer(id, { ...server, args: e.target.value.split(/\s+/).filter(Boolean) })
                          }
                          placeholder="-y @modelcontextprotocol/server-filesystem C:\path"
                        />
                      </label>
                      <label className="mcp-grid-wide">
                        {t("set.mcp.env")}
                        <textarea
                          value={mcpSecretEdits[id] ?? ""}
                          onChange={(e) => editSecrets(id, e.target.value)}
                          placeholder={t("set.mcp.envPlaceholder")}
                          rows={2}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        URL
                        <input
                          type="text"
                          value={server.url ?? ""}
                          onChange={(e) => updateServer(id, { ...server, url: e.target.value })}
                          placeholder="https://mcp.example.com"
                        />
                      </label>
                      <label className="mcp-grid-wide">
                        {t("set.mcp.headers")}
                        <textarea
                          value={mcpSecretEdits[id] ?? ""}
                          onChange={(e) => editSecrets(id, e.target.value)}
                          placeholder={t("set.mcp.headersPlaceholder")}
                          rows={2}
                        />
                      </label>
                    </>
                  )}
                </div>

                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={server.autoStart !== false}
                    onChange={(e) => updateServer(id, { ...server, autoStart: e.target.checked })}
                  />
                  {t("set.mcp.autoStart")}
                </label>

                <div className="mcp-test-row">
                  <button
                    type="button"
                    className="mcp-small-btn"
                    disabled={!canTest || test?.testing === true}
                    title={t("set.mcp.testHint")}
                    onClick={() => void runTest(id)}
                  >
                    {test?.testing ? t("set.mcp.testing") : t("set.mcp.test")}
                  </button>
                  {test && !test.testing && test.result.ok && (
                    <span className="mcp-test-ok">
                      <CheckIcon className="hero-icon" />{" "}
                      {t(test.result.toolCount === 1 ? "set.mcp.testOkOne" : "set.mcp.testOk", {
                        count: test.result.toolCount,
                        ms: test.result.durationMs,
                      })}
                    </span>
                  )}
                  {test && !test.testing && !test.result.ok && (
                    <span className="mcp-test-fail">
                      <ExclamationTriangleIcon className="hero-icon" /> {t("set.mcp.testFailed", { error: test.result.error ?? "" })}
                    </span>
                  )}
                </div>
                {test && !test.testing && test.result.ok && test.result.tools.length > 0 && (
                  <p className="muted mcp-test-tools" title={test.result.tools.join(", ")}>
                    {test.result.tools.join(", ")}
                  </p>
                )}

                {status && !status.connected && status.state !== "connecting" && status.state !== "stopped" && (
                  <p className="provider-warning">
                    <ExclamationTriangleIcon className="hero-icon" /> {status.error ?? t("set.mcp.notConnectedLower")}
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}
      {entries.length === 0 && <p className="muted">{t("set.mcp.none")}</p>}
    </section>
  );
}

/** Fold session-only secret edits (env for stdio, headers for http — write-only, never
 * pre-filled from config.get since sanitizeConfigForClient strips them, see sanitize.ts)
 * into the mcpServers object SettingsView.save() sends in its config.patch. */
export function buildMcpServersPatch(
  config: ConfigShape,
  mcpSecretEdits: Record<string, string>,
): Record<string, unknown> {
  const servers: Record<string, unknown> = { ...config.mcpServers };
  for (const [id, raw] of Object.entries(mcpSecretEdits)) {
    const server = servers[id] as ConfigMcpServer | undefined;
    if (!server || !raw.trim()) continue;
    const pairs: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      pairs[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    servers[id] = server.transport === "stdio" ? { ...server, env: pairs } : { ...server, headers: pairs };
  }
  return servers;
}
