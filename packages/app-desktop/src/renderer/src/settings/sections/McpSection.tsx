import { useState } from "react";
import { CheckIcon, ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/20/solid";
import type { ConfigMcpServer, ConfigShape, McpServerStatus } from "../../types.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  mcpStatus: McpServerStatus[];
  onMcpAction: (method: "mcp.reconnect" | "mcp.disconnect", serverId: string) => void;
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
function parseMcpServersJson(raw: string): ParsedMcpServer[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Expected a JSON object");
  }

  const wrapped = (data as Record<string, unknown>).mcpServers;
  const map = wrapped !== undefined ? wrapped : data;
  if (typeof map !== "object" || map === null || Array.isArray(map)) {
    throw new Error('Expected an object of server entries (optionally wrapped in "mcpServers")');
  }

  const results: ParsedMcpServer[] = [];
  for (const [id, value] of Object.entries(map as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      throw new Error(`"${id}": expected an object`);
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
      throw new Error(`"${id}": must have either "command" (stdio) or "url" (http)`);
    }
  }

  if (results.length === 0) {
    throw new Error("No server entries found");
  }
  return results;
}

export function McpSection({ config, setConfig, mcpStatus, onMcpAction, mcpSecretEdits, setMcpSecretEdits }: Props) {
  const servers = config.mcpServers ?? {};
  const entries = Object.entries(servers);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const updateServer = (id: string, next: ConfigMcpServer) => {
    setConfig({ ...config, mcpServers: { ...servers, [id]: next } });
  };

  const renameServer = (oldId: string, newId: string) => {
    if (!newId || newId === oldId || servers[newId]) return;
    const rest = { ...servers };
    const entry = rest[oldId];
    delete rest[oldId];
    setConfig({ ...config, mcpServers: { ...rest, [newId]: entry } });
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
  };

  const applyImport = () => {
    let parsed: ParsedMcpServer[];
    try {
      parsed = parseMcpServersJson(importText);
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
    setImportText("");
    setImportError(null);
    setShowImport(false);
  };

  return (
    <section className="settings-section">
      <h3>MCP Servers</h3>
      <p className="muted">
        Connect Model Context Protocol servers to give agents more tools. Servers connect in the
        background; save to apply changes, or use Reconnect on a single server.
      </p>
      {entries.map(([id, server]) => {
        const status = mcpStatus.find((s) => s.id === id);
        return (
          <div key={id} className="settings-provider">
            <div className="mcp-server-header">
              <input
                type="text"
                value={id}
                onChange={(e) => renameServer(id, e.target.value.trim())}
                className="mcp-id-input"
              />
              <button type="button" className="icon-btn" onClick={() => removeServer(id)} title="Remove server">
                <XMarkIcon className="hero-icon" />
              </button>
            </div>

            <label>
              Transport
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
                <option value="stdio">stdio (local command)</option>
                <option value="http">http (remote URL)</option>
              </select>
            </label>

            {server.transport === "stdio" ? (
              <>
                <label>
                  Command
                  <input
                    type="text"
                    value={server.command ?? ""}
                    onChange={(e) => updateServer(id, { ...server, command: e.target.value })}
                    placeholder="npx"
                  />
                </label>
                <label>
                  Args (space-separated)
                  <input
                    type="text"
                    value={(server.args ?? []).join(" ")}
                    onChange={(e) =>
                      updateServer(id, { ...server, args: e.target.value.split(/\s+/).filter(Boolean) })
                    }
                    placeholder="-y @modelcontextprotocol/server-filesystem C:\path"
                  />
                </label>
                <label>
                  Environment variables
                  <textarea
                    value={mcpSecretEdits[id] ?? ""}
                    onChange={(e) => setMcpSecretEdits({ ...mcpSecretEdits, [id]: e.target.value })}
                    placeholder={"Leave blank to keep current values\nKEY=value"}
                    rows={3}
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
                <label>
                  Headers
                  <textarea
                    value={mcpSecretEdits[id] ?? ""}
                    onChange={(e) => setMcpSecretEdits({ ...mcpSecretEdits, [id]: e.target.value })}
                    placeholder={"Leave blank to keep current values\nAuthorization=Bearer …"}
                    rows={3}
                  />
                </label>
              </>
            )}

            <label className="mcp-autostart">
              <input
                type="checkbox"
                checked={server.autoStart !== false}
                onChange={(e) => updateServer(id, { ...server, autoStart: e.target.checked })}
              />
              Connect automatically when the project opens
            </label>

            {status &&
              (status.connected ? (
                <p className="mcp-status-ok">
                  <CheckIcon className="hero-icon" /> connected — {status.toolCount} tool
                  {status.toolCount === 1 ? "" : "s"}
                </p>
              ) : status.state === "connecting" ? (
                <p className="muted">Connecting…</p>
              ) : status.state === "stopped" ? (
                <p className="muted">Not connected</p>
              ) : (
                <p className="provider-warning">
                  <ExclamationTriangleIcon className="hero-icon" /> {status.error ?? "not connected"}
                </p>
              ))}
            {status && (
              <div className="agent-form-actions">
                <button
                  type="button"
                  disabled={status.state === "connecting"}
                  onClick={() => onMcpAction("mcp.reconnect", id)}
                >
                  {status.connected ? "Reconnect" : "Connect"}
                </button>
                {status.connected && (
                  <button type="button" onClick={() => onMcpAction("mcp.disconnect", id)}>
                    Disconnect
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {entries.length === 0 && <p className="muted">No MCP servers configured</p>}

      {showImport ? (
        <div className="mcp-import">
          <label>
            Paste MCP server JSON
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
              Cancel
            </button>
            <button type="button" onClick={applyImport} disabled={!importText.trim()}>
              Import
            </button>
          </div>
        </div>
      ) : (
        <div className="mcp-add-actions">
          <button type="button" className="new-chat" onClick={addServer}>
            + Add MCP server
          </button>
          <button type="button" className="new-chat" onClick={() => setShowImport(true)}>
            + Import JSON
          </button>
        </div>
      )}
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
