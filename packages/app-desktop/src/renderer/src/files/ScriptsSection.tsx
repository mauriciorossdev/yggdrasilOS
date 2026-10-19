import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { CollapsibleSection } from "../components/CollapsibleSection.js";
import type { FsListResult, FsReadResult } from "../types.js";

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
 * on click, running one in a new native OS terminal window
 * (main/scriptRunner.ts) — deliberately NOT one of this app's own node-pty/
 * xterm.js terminal panes (nesting it there is a possible future
 * enhancement, not this). Renders nothing at all — no empty "Scripts"
 * header either — when the project has no package.json or no scripts.
 */
export function ScriptsSection({ projectPath }: Props) {
  const { call, authenticated } = useGateway();
  const [scripts, setScripts] = useState<Record<string, string> | null>(null);
  const [packageManager, setPackageManager] = useState("npm");
  const [runningScript, setRunningScript] = useState<string | null>(null);
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

  const runScript = (name: string) => {
    if (!projectPath) return;
    setRunningScript(name);
    setError(null);
    void window.yggdrasil.scripts
      .runInTerminal({ cwd: projectPath, packageManager, scriptName: name })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRunningScript(null));
  };

  return (
    <CollapsibleSection title="Scripts" className="scripts-section">
      {error && (
        <p className="error" style={{ margin: "0 12px 4px", fontSize: 12 }}>
          {error}
        </p>
      )}
      <ul className="script-list">
        {Object.entries(scripts).map(([name, cmd]) => (
          <li key={name} className="script-row">
            <div className="script-row-info">
              <div className="script-row-name" title={cmd}>
                {name}
              </div>
            </div>
            <button
              type="button"
              className="icon-btn"
              title={`Run "${packageManager} run ${name}" in a new terminal`}
              onClick={() => runScript(name)}
              disabled={runningScript === name}
            >
              {runningScript === name ? "…" : "▶"}
            </button>
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}
