import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { PluginRecord } from "../types.js";
import { buildStudioTerminalLaunch, type StudioTerminalHarness } from "./studioContext.js";

type Props = {
  plugin: PluginRecord;
  projectPath: string;
  /** User-chosen CLI — see StudioWorkspace's harness selector. Never hardcoded: buildStudioTerminalLaunch handles claude and agy differently (see its own doc comment). */
  harness: StudioTerminalHarness;
};

/**
 * A single, always-fresh terminal (running `claude` or `agy`, the user's
 * choice via the `harness` prop — never hardcoded) spawned to author one
 * complemento — NOT TerminalContainer's shared pane-tree/registry (that
 * machinery exists for the Terminal tab's multi-pane grid; this component
 * needs none of it, see the plan doc's terminal-embedding section).
 *
 * Disposes its pty for real in this same effect's cleanup — unlike
 * TerminalPane.tsx, which deliberately defers real disposal to
 * TerminalContainer's own diffing effect (since a tree leaf can remount
 * many times there without really closing), every mount of this component
 * IS a brand-new session, so disposing on unmount (switching mode, picking
 * a different plugin, or leaving Estudio) is the correct, simpler behavior
 * here.
 */
export function StudioTerminalPane({ plugin, projectPath, harness }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const id = `studio-${plugin.key}-${crypto.randomUUID()}`;
    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
      fontSize: 13,
      theme: { background: "#000000", foreground: "#e6e6e6" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    const { command, args } = buildStudioTerminalLaunch(harness, plugin);
    void window.yggdrasil.terminals.create({
      id,
      cwd: projectPath,
      cols: term.cols,
      rows: term.rows,
      command,
      args,
    });

    term.onData((data) => void window.yggdrasil.terminals.write(id, data));
    const unsubData = window.yggdrasil.terminals.onData((tid, chunk) => {
      if (tid === id) term.write(chunk);
    });
    const unsubExit = window.yggdrasil.terminals.onExit((tid) => {
      if (tid === id) term.write("\r\n\x1b[90m[proceso terminado]\x1b[0m\r\n");
    });
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      void window.yggdrasil.terminals.resize(id, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      unsubData();
      unsubExit();
      resizeObserver.disconnect();
      term.dispose();
      void window.yggdrasil.terminals.dispose(id);
    };
    // Re-runs on plugin.key or harness (the user explicitly switching CLI is
    // a real "start a new session" action) — but NOT on every `plugin`
    // object identity change a fresh usePlugins() poll hands back for the
    // same key, which must never respawn a live, in-progress terminal
    // session out from under the user; projectPath is static per window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.key, harness]);

  return (
    <div className="terminal-pane">
      <div className="terminal-pane-body" ref={containerRef} />
    </div>
  );
}
