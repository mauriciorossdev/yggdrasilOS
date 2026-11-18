import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { CollapsibleSection } from "../components/CollapsibleSection.js";
import type { FsListResult, FsReadResult } from "../types.js";
import { useI18n } from "../i18n/index.js";
import { useScriptsInApp } from "../ui/sidebarStore.js";
import { markStopRequested, requestScriptCommand, useScriptRuns, type ScriptRun } from "../scripts/scriptRuns.js";

type Props = {
  projectPath: string | undefined;
};

// Same lockfile convention as packages/context-project/src/index.ts's
// detectPackageManager — reimplemented locally rather than pulled in as a
// dependency just for this. First match wins; no lockfile recognized falls
// back to npm.
const LOCKFILE_PACKAGE_MANAGERS: Array<{ file: string; packageManager: string }> = [
  { file: "pnpm-lock.yaml", packageManager: "pnpm" },
  { file: "pnpm-workspace.yaml", packageManager: "pnpm" },
  { file: "yarn.lock", packageManager: "yarn" },
  { file: "bun.lockb", packageManager: "bun" },
  { file: "package-lock.json", packageManager: "npm" },
];

/**
 * Sidebar section (own CollapsibleSection, rendered directly under "Files"
 * in SessionSidebar.tsx) listing this project's package.json scripts and,
 * on click, running one in its own pane of the app's Terminal tab
 * (TerminalContainer handles the command, see scripts/scriptRuns.ts) with a
 * live status and stop/restart. Settings → General can send them to a new OS
 * terminal window instead (main/scriptRunner.ts). Renders nothing at all —
 * no empty "Scripts" header either — when the project has no package.json or
 * no scripts.
 */
export function ScriptsSection({ projectPath }: Props) {
  const { t } = useI18n();
  const { call, authenticated } = useGateway();
  const [scripts, setScripts] = useState<Record<string, string> | null>(null);
  const [packageManager, setPackageManager] = useState("npm");
  const [runningScript, setRunningScript] = useState<string | null>(null);
  const inApp = useScriptsInApp();
  const runs = useScriptRuns();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setScripts(null);
    setError(null);
    // Re-runs once the socket is back after a drop (see FileTree.tsx) — a
    // read that failed while disconnected would otherwise hide this section
    // for the rest of the window's life.
    if (!projectPath || !authenticated) return;

    void Promise.all([
      call<FsReadResult>("fs.read", { relativePath: "package.json" }),
      call<FsListResult>("fs.list", { relativePath: "" }),
    ])
      .then(([pkg, list]) => {
        if (cancelled) return;
        const parsed = JSON.parse(pkg.content) as { scripts?: Record<string, string> };
        setScripts(parsed.scripts && Object.keys(parsed.scripts).length > 0 ? parsed.scripts : null);
        const names = new Set(list.entries.map((e) => e.name));
        const match = LOCKFILE_PACKAGE_MANAGERS.find((l) => names.has(l.file));
        setPackageManager(match?.packageManager ?? "npm");
      })
      .catch(() => {
        // No package.json, unreadable, or invalid JSON — this project just
        // doesn't get a Scripts section, not an error worth surfacing.
        if (!cancelled) setScripts(null);
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath, call, authenticated]);

  if (!scripts) return null;

  const stopScript = (run: ScriptRun, name: string) => {
    markStopRequested(name);
    void window.yggdrasil.terminals.write(run.paneId, "\x03");
  };

  const runScript = (name: string) => {
    if (!projectPath) return;
    if (inApp) {
      requestScriptCommand({ type: "run", name, packageManager, cwd: projectPath });
      return;
    }
    setRunningScript(name);
    setError(null);
    void window.yggdrasil.scripts
      .runInTerminal({ cwd: projectPath, packageManager, scriptName: name })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRunningScript(null));
  };

  return (
    <CollapsibleSection title="Scripts" id="scripts" count={Object.keys(scripts).length} className="scripts-section">
      {error && (
        <p className="error" style={{ margin: "0 12px 4px", fontSize: 12 }}>
          {error}
        </p>
      )}
      <ul className="script-list">
        {Object.entries(scripts).map(([name, cmd]) => {
          const run = inApp ? runs.get(name) : undefined;
          const running = run?.status === "running";
          const statusText = run
            ? t(`scripts.status.${run.status}`, { code: run.exitCode ?? "?" })
            : undefined;
          return (
            <li key={name} className="script-row">
              {run && <span className={`script-status ${run.status}`} role="img" aria-label={statusText} title={statusText} />}
              <div className="script-row-info">
                {run ? (
                  <button
                    type="button"
                    className="script-row-name script-row-link"
                    title={`${cmd}\n${t("scripts.show")}`}
                    onClick={() => requestScriptCommand({ type: "focus", name })}
                  >
                    {name}
                  </button>
                ) : (
                  <div className="script-row-name" title={cmd}>
                    {name}
                  </div>
                )}
              </div>
              <div className="script-row-actions">
                {running && run && (
                  <>
                    <button type="button" className="icon-btn script-act" title={t("scripts.stop")} aria-label={t("scripts.stop")} onClick={() => stopScript(run, name)}>
                      ■
                    </button>
                    <button
                      type="button"
                      className="icon-btn script-act"
                      title={t("scripts.restart")}
                      aria-label={t("scripts.restart")}
                      onClick={() => projectPath && requestScriptCommand({ type: "restart", name, packageManager, cwd: projectPath })}
                    >
                      ↻
                    </button>
                  </>
                )}
                {!running && (
                  <button
                    type="button"
                    className="icon-btn"
                    title={t("scripts.run", { command: `${packageManager} run ${name}` })}
                    onClick={() => runScript(name)}
                    disabled={runningScript === name}
                  >
                    {runningScript === name ? "…" : "▶"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}
