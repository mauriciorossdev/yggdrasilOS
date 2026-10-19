import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";

type SessionSummary = {
  sessionKey: string;
  title?: string;
  messageCount?: number;
  updatedAt?: number;
};

type SessionRecord = {
  sessionKey: string;
  title?: string;
  messages?: Array<{ role: string; content: string }>;
};

export function SessionsPage() {
  const { call, connected } = useGateway();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<SessionRecord | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await call<{ sessions: SessionSummary[] }>("sessions.list");
    setSessions(res.sessions ?? []);
  };

  useEffect(() => {
    if (!connected) return;
    void load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [call, connected]);

  const open = async (sessionKey: string) => {
    const res = await call<{ session: SessionRecord | null }>("sessions.get", { sessionKey });
    setSelected(res.session);
    setTitle(res.session?.title ?? "");
  };

  const reset = async (sessionKey: string) => {
    await call("sessions.reset", { sessionKey });
    setSelected(null);
    await load();
  };

  const saveTitle = async () => {
    if (!selected) return;
    await call("sessions.patch", { sessionKey: selected.sessionKey, title });
    await open(selected.sessionKey);
    await load();
  };

  if (error) return <p className="error">{error}</p>;

  return (
    <div className="page sessions-page">
      <h1>Sessions</h1>
      <div className="sessions-layout">
        <ul className="session-list card">
          {sessions.map((s) => (
            <li key={s.sessionKey}>
              <button type="button" className="link-btn" onClick={() => void open(s.sessionKey)}>
                {s.title || s.sessionKey}
              </button>
            </li>
          ))}
          {!sessions.length && <li className="muted">Sin sesiones</li>}
        </ul>
        {selected && (
          <section className="card session-detail">
            <h2>{selected.sessionKey}</h2>
            <label>
              Título
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="row">
              <button type="button" onClick={() => void saveTitle()}>
                Guardar título
              </button>
              <button type="button" className="danger" onClick={() => void reset(selected.sessionKey)}>
                Reset
              </button>
            </div>
            <pre className="messages-preview">
              {JSON.stringify(selected.messages ?? [], null, 2)}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
