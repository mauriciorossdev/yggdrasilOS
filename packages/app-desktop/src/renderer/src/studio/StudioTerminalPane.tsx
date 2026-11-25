import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { PluginRecord } from "../types.js";
import { getThemeColors, onThemeApplied } from "@yggdrasil/ui-kit";
import { terminalColors } from "@yggdrasil/ui-kit";
import { buildStudioTerminalLaunch, type StudioTerminalHarness } from "./studioContext.js";
import { t } from "../i18n/index.js";

type Props = {
  plugin: PluginRecord;
  projectPath: string;
  /** User-chosen CLI — see StudioWorkspace's harness selector. Never hardcoded: buildStudioTerminalLaunch handles claude and agy differently (see its own doc comment). */
  harness: StudioTerminalHarness;
  /** Sent as the session's first message — only on the first spawn, never again on a CLI switch. */
  initialPrompt?: string;
};

/** Lets the workspace hand the running agent a message ("pedir arreglo"). */
export type StudioAgentHandle = { send: (text: string) => void };

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
 * IS a brand-new session, so disposing on unmount (switching CLI, picking
 * a different plugin, or leaving Estudio) is the correct, simpler behavior
 * here.
 */
export const StudioTerminalPane = forwardRef<StudioAgentHandle, Props>(function StudioTerminalPane(
  { plugin, projectPath, harness, initialPrompt },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ptyIdRef = useRef<string | null>(null);
  // The first message belongs to the session started with the initial CLI.
  // Kept (not cleared at spawn) so a StrictMode double-run of the effect —
  // whose first pty is disposed right away — still sends it; dropped for
  // good once the user switches CLI. A real remount gets no prompt at all:
  // the workspace's launch is one-shot (StudioView drops it once consumed).
  const initialRef = useRef<{ prompt?: string; harness: StudioTerminalHarness }>({ prompt: initialPrompt, harness });

  useImperativeHandle(ref, () => ({
    send(text: string) {
      // terminal:submit types it in and presses Enter, or queues it while a
      // claude turn is still running (paneQueueHost.ts).
      if (ptyIdRef.current) void window.yggdrasil.terminals.submit(ptyIdRef.current, text);
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const id = `studio-${plugin.key}-${crypto.randomUUID()}`;
    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
      fontSize: 13,
      theme: terminalColors(getThemeColors()),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    if (harness !== initialRef.current.harness) initialRef.current.prompt = undefined;
    const { command, args } = buildStudioTerminalLaunch(harness, plugin, initialRef.current.prompt);
    ptyIdRef.current = id;
    void window.yggdrasil.terminals.create({
      id,
      cwd: projectPath,
      cols: term.cols,
      rows: term.rows,
      command,
      args,
    });

    term.onData((data) => void window.yggdrasil.terminals.write(id, data));
    const unsubTheme = onThemeApplied((core) => {
      term.options.theme = terminalColors(core);
    });
    const unsubData = window.yggdrasil.terminals.onData((tid, chunk) => {
      if (tid === id) term.write(chunk);
    });
    const unsubExit = window.yggdrasil.terminals.onExit((tid) => {
      if (tid === id) term.write(`\r\n\x1b[90m${t("studio.terminal.ended")}\x1b[0m\r\n`);
    });
    const resizeObserver = new ResizeObserver(() => {
      // Hidden (display:none while the Estudio shows Chat): keep the last
      // real size instead of fitting the pty down to nothing.
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      fitAddon.fit();
      void window.yggdrasil.terminals.resize(id, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      unsubTheme();
      unsubData();
      unsubExit();
      resizeObserver.disconnect();
      term.dispose();
      void window.yggdrasil.terminals.dispose(id);
      if (ptyIdRef.current === id) ptyIdRef.current = null;
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
});
