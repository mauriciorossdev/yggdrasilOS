import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { getThemeColors, onThemeApplied } from "../ui/theme/themeRuntime.js";
import { terminalColors } from "../ui/theme/surfaces.js";

/**
 * Read-only second view of a running pty. It starts from the main process'
 * serialized screen (an exact snapshot, unlike replaying raw output, which
 * garbles a pty that was resized), then follows terminal:data, skipping the
 * chunks the snapshot already holds (seq). It never resizes the pty: it adopts
 * the pane's size (snapshot, then terminal:resized) and scrolls if bigger than
 * its box.
 */
export function TerminalMirror({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
      fontSize: 13,
      theme: terminalColors(getThemeColors()),
      disableStdin: true,
      cursorBlink: false,
      scrollback: 2000,
    });
    term.open(container);
    // The pane can be taller than the box: keep the bottom (input box, status bar) in view while the
    // user hasn't scrolled up, and stop following once they do.
    const scroller = container.parentElement;
    let stick = true;
    const onScroll = () => {
      if (scroller) stick = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
    };
    scroller?.addEventListener("scroll", onScroll);
    const unsubRender = term.onRender(() => {
      if (stick && scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    const unsubTheme = onThemeApplied((core) => {
      term.options.theme = terminalColors(core);
    });

    let live = true;
    let snapSeq: number | null = null;
    const pending: Array<{ chunk: string; seq?: number }> = [];
    const apply = (chunk: string, seq?: number) => {
      if (seq !== undefined && snapSeq !== null && seq <= snapSeq) return;
      term.write(chunk);
    };
    const unsubData = window.yggdrasil.terminals.onData((tid, chunk, seq) => {
      if (tid !== id) return;
      if (snapSeq === null) pending.push({ chunk, seq });
      else apply(chunk, seq);
    });
    const unsubResize = window.yggdrasil.terminals.onResized((tid, cols, rows) => {
      if (tid === id) term.resize(cols, rows);
    });
    void window.yggdrasil.terminals.snapshot(id).then((snap) => {
      if (!live) return;
      if (snap) {
        term.resize(snap.cols, snap.rows);
        term.write(snap.data);
        snapSeq = snap.seq;
      } else {
        snapSeq = Number.MAX_SAFE_INTEGER; // pty is gone: nothing to follow
      }
      for (const p of pending) apply(p.chunk, p.seq);
      pending.length = 0;
    });

    return () => {
      live = false;
      unsubData();
      unsubResize();
      unsubTheme();
      unsubRender.dispose();
      scroller?.removeEventListener("scroll", onScroll);
      term.dispose();
    };
  }, [id]);

  return (
    <div className="wt-mirror" data-testid="terminal-mirror">
      <div ref={ref} />
    </div>
  );
}
