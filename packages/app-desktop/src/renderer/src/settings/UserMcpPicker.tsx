import type { UserMcpChoice, UserMcpServer } from "../types.js";
import { useI18n } from "../i18n/index.js";

/**
 * Which user-scope MCP servers a claude pane loads (main/claudePaneSettings.ts):
 * All / None / Pick, with one checkbox per server under Pick. Used by
 * Settings → Agent CLIs (global) and by an Agent Flow claude node, where
 * `value` undefined means "use the global setting".
 */
export function UserMcpPicker({
  value,
  servers,
  allowGlobal,
  onChange,
}: {
  value: UserMcpChoice | undefined;
  servers: UserMcpServer[];
  /** Node mode: offers "Use the global setting" (value undefined). */
  allowGlobal?: boolean;
  onChange: (next: UserMcpChoice | undefined) => void;
}) {
  const { t } = useI18n();
  if (servers.length === 0) return <p className="muted">{t("set.cliAgents.userMcpNone")}</p>;
  const names = servers.map((s) => s.name);
  const mode = value?.mode ?? (allowGlobal ? "global" : "all");
  const pick = (allowed: string[]) => onChange({ mode: "pick", allowed, known: names });
  return (
    <div className="user-mcp-picker">
      <select
        value={mode}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "global") onChange(undefined);
          else if (next === "pick") pick(value?.mode === "pick" ? value.allowed : value?.mode === "none" ? [] : names);
          else onChange({ mode: next as "all" | "none", allowed: [], known: names });
        }}
      >
        {allowGlobal && <option value="global">{t("set.cliAgents.userMcpGlobal")}</option>}
        <option value="all">{t("set.cliAgents.userMcpAll")}</option>
        <option value="none">{t("set.cliAgents.userMcpNoneOption")}</option>
        <option value="pick">{t("set.cliAgents.userMcpPick")}</option>
      </select>
      {value?.mode === "pick" && (
        <ul className="user-mcp-list">
          {servers.map((server) => {
            const isNew = value.known !== undefined && !value.known.includes(server.name);
            return (
              <li key={server.name}>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={value.allowed.includes(server.name)}
                    onChange={(e) =>
                      pick(e.target.checked ? [...value.allowed, server.name] : value.allowed.filter((n) => n !== server.name))
                    }
                  />
                  <span>{server.name}</span>
                  <span className="muted">· {t(server.kind === "local" ? "set.cliAgents.userMcpLocal" : "set.cliAgents.userMcpRemote")}</span>
                  {isNew && <span className="user-mcp-new">{t("set.cliAgents.userMcpNew")}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
