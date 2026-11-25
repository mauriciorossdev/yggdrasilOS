import { useEffect, useRef, useState } from "react";
import { PluginFrame } from "../plugins/PluginFrame.js";
import type { PluginConsoleEntry, PluginErrorEntry, PluginLogEntry } from "../plugins/pluginTypes.js";
import type { PluginRecord, PluginView } from "../types.js";
import { StudioStage } from "./StudioStage.js";
import { useI18n } from "../i18n/index.js";

/** What the preview tells the workspace: console counts, and whether the plugin finished loading (its SDK said ygg:ready) since the last reload. */
export type StudioPreviewStatus = { errors: number; warns: number; logs: number; ready: boolean };

type Props = {
  plugin: PluginRecord;
  /** Which host shape to preview the complemento in — chosen in StudioWorkspace's toolbar. */
  view: PluginView;
  /** Bumped by StudioWorkspace (Recargar, a file change, saved Ajustes) — reloads the iframe and clears the console. */
  version: number;
  onStatusChange?: (status: StudioPreviewStatus) => void;
  /** "Pedir arreglo al agente" on a console error. Absent = no button. */
  onAskFix?: (entry: PluginErrorEntry) => void;
};

// Capped so a chatty plugin (a tight console.log loop) can't grow this
// state unboundedly — a development log, not an audit trail.
const MAX_LOGS = 200;

function countsOf(logs: PluginLogEntry[]): Omit<StudioPreviewStatus, "ready"> {
  let errors = 0;
  let warns = 0;
  let plain = 0;
  for (const e of logs) {
    if (e.kind === "error" || e.level === "error") errors++;
    else if (e.level === "warn") warns++;
    else plain++;
  }
  return { errors, warns, logs: plain };
}

/**
 * The Estudio's live "Test" pane: the complemento's real iframe (same
 * `PluginFrame` normal tabs/panels use) framed by StudioStage, plus a
 * collapsible console fed by pluginSdk.ts's console/error capture (and the
 * main process's copy of errors the frame itself can't see). The console
 * starts folded and opens itself on the first error after each reload.
 */
export function StudioPreview({ plugin, view, version, onStatusChange, onAskFix }: Props) {
  const { t } = useI18n();
  const [logs, setLogs] = useState<PluginLogEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    setLogs([]);
    setReady(false);
    autoOpenedRef.current = false;
  }, [version, plugin.key]);

  useEffect(() => {
    onStatusChange?.({ ...countsOf(logs), ready });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, ready]);

  const push = (entry: PluginLogEntry) => {
    setLogs((prev) => [...prev, entry].slice(-MAX_LOGS));
    const isError = entry.kind === "error" || entry.level === "error";
    if (isError && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setConsoleOpen(true);
    }
  };
  const pushConsole = (entry: Omit<PluginConsoleEntry, "kind">) => push({ kind: "console", ...entry });
  const pushError = (entry: Omit<PluginErrorEntry, "kind">) => push({ kind: "error", ...entry });

  const counts = countsOf(logs);

  return (
    <div className="studio-preview">
      <StudioStage view={view}>
        <PluginFrame
          plugin={plugin}
          version={version}
          visible
          onConsole={pushConsole}
          onError={pushError}
          onReady={() => setReady(true)}
        />
      </StudioStage>
      <div className={`studio-console${consoleOpen ? " open" : ""}`}>
        <button
          type="button"
          className="studio-console-toggle"
          aria-expanded={consoleOpen}
          onClick={() => setConsoleOpen((o) => !o)}
        >
          <span className="studio-console-caret">{consoleOpen ? "▾" : "▴"}</span>
          {t("studio.preview.console")}
          {counts.errors > 0 && (
            <span className="studio-count studio-count-error">
              {t(counts.errors === 1 ? "studio.preview.errors_one" : "studio.preview.errors_other", { count: counts.errors })}
            </span>
          )}
          {counts.warns > 0 && (
            <span className="studio-count studio-count-warn">
              {t(counts.warns === 1 ? "studio.preview.warns_one" : "studio.preview.warns_other", { count: counts.warns })}
            </span>
          )}
          {counts.logs > 0 && (
            <span className="studio-count">
              {t(counts.logs === 1 ? "studio.preview.logs_one" : "studio.preview.logs_other", { count: counts.logs })}
            </span>
          )}
        </button>
        {consoleOpen && (
          <div className="studio-preview-log">
            {logs.length === 0 && <p className="muted studio-preview-log-empty">{t("studio.preview.noLogs")}</p>}
            {logs.map((entry, i) => (
              <div key={i} className={`studio-log-entry studio-log-${entry.kind === "error" ? "error" : entry.level}`}>
                {entry.kind === "error" ? (
                  <>
                    <span className="studio-log-badge">error</span> {entry.message}
                    {entry.stack && <pre>{entry.stack}</pre>}
                    {onAskFix && (
                      <button type="button" className="studio-ask-fix" onClick={() => onAskFix(entry)}>
                        {t("studio.preview.askFix")}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <span className="studio-log-badge">{entry.level}</span> {entry.args.join(" ")}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
