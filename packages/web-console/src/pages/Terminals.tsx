import { useCallback, useEffect, useRef, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { Chip } from "@yggdrasil/ui-kit";
import { useT } from "../i18n";

type Pane = { id: string; title: string; cwd: string; createdAt: number; working: boolean };

/**
 * The desktop app's terminal panes for this project: see their recent output and send them
 * a line. Only a desktop project gateway has panes (the TUI's own gateway says so).
 */
export function TerminalsPage() {
  const { call, connected } = useGateway();
  const t = useT();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [panes, setPanes] = useState<Pane[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await call<{ available: boolean; panes: Pane[] }>("terminals.list");
      setAvailable(r.available);
      setPanes(r.panes);
      setSelected((cur) => cur ?? r.panes[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [call]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  // Poll the open pane's tail (and the list's "working" flags) every 2 s.
  useEffect(() => {
    if (!connected || !selected) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await call<{ text: string }>("terminals.read", { id: selected, maxChars: 12_000 });
        if (!stop) setOutput(r.text);
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void tick();
    const timer = setInterval(() => {
      void tick();
      void refresh();
    }, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [connected, selected, call, refresh]);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [output]);

  const send = async () => {
    if (!selected || !input.trim()) return;
    await call("terminals.write", { id: selected, text: input, pressEnter: true });
    setInput("");
  };

  return (
    <div className="page">
      <h1>{t("nav.terminals")}</h1>
      {error && <p className="error">{error}</p>}
      {available === null ? (
        <p className="muted">{t("common.loading")}</p>
      ) : !available ? (
        <p className="muted">{t("term.unavailable")}</p>
      ) : panes.length === 0 ? (
        <p className="muted">{t("term.none")}</p>
      ) : (
        <div className="split">
          <aside className="card list-pane">
            <ul className="pick-list">
              {panes.map((p) => (
                <li key={p.id}>
                  <button type="button" className={`pick-item${p.id === selected ? " active" : ""}`} onClick={() => setSelected(p.id)}>
                    <span className="row">
                      {p.title}
                      {p.working && <Chip tone="working">{t("term.working")}</Chip>}
                    </span>
                    <span className="muted pick-sub mono">{p.cwd}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <section className="card detail-pane terminal-pane">
            <pre className="code-view terminal-output" ref={outputRef}>
              {output}
            </pre>
            <form
              className="chat-input"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input className="mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("term.placeholder")} />
              <button type="submit" disabled={!input.trim()}>
                {t("chat.send")}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
