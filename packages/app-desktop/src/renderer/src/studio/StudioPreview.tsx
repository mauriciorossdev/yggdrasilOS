import { useState } from "react";
import { PluginFrame } from "../plugins/PluginFrame.js";
import type { PluginConsoleEntry, PluginErrorEntry, PluginLogEntry } from "../plugins/pluginTypes.js";
import type { PluginRecord } from "../types.js";

type Props = { plugin: PluginRecord };

// Capped so a chatty plugin (a tight console.log loop) can't grow this
// state unboundedly — a development log, not an audit trail.
const MAX_LOGS = 200;

/**
 * The Estudio's live "Test" pane: the complemento's real iframe (same
 * `PluginFrame` normal tabs/panels use) plus a console/error log fed by
 * pluginSdk.ts's console/error capture. `version` is local — independent of
 * the app-wide `usePlugins().version` — so "Recargar" here doesn't force
 * every other open plugin tab/panel to reload too.
 */
export function StudioPreview({ plugin }: Props) {
  const [version, setVersion] = useState(0);
  const [logs, setLogs] = useState<PluginLogEntry[]>([]);

  const pushConsole = (entry: Omit<PluginConsoleEntry, "kind">) => {
    const next: PluginConsoleEntry = { kind: "console", ...entry };
    setLogs((prev) => [...prev, next].slice(-MAX_LOGS));
  };
  const pushError = (entry: Omit<PluginErrorEntry, "kind">) => {
    const next: PluginErrorEntry = { kind: "error", ...entry };
    setLogs((prev) => [...prev, next].slice(-MAX_LOGS));
  };

  const reload = () => {
    setVersion((v) => v + 1);
    setLogs([]);
  };

  return (
    <div className="studio-preview">
      <div className="studio-preview-toolbar">
        <span className="muted">Vista previa</span>
        <button type="button" onClick={reload}>
          Recargar
        </button>
      </div>
      <div className="studio-preview-frame">
        <PluginFrame plugin={plugin} version={version} visible onConsole={pushConsole} onError={pushError} />
      </div>
      <div className="studio-preview-log">
        {logs.length === 0 && <p className="muted studio-preview-log-empty">Sin logs todavía.</p>}
        {logs.map((entry, i) => (
          <div
            key={i}
            className={`studio-log-entry studio-log-${entry.kind === "error" ? "error" : entry.level}`}
          >
            {entry.kind === "error" ? (
              <>
                <span className="studio-log-badge">error</span> {entry.message}
                {entry.stack && <pre>{entry.stack}</pre>}
              </>
            ) : (
              <>
                <span className="studio-log-badge">{entry.level}</span> {entry.args.join(" ")}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
