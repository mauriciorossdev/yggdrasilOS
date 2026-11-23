import { useCallback, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { useT } from "../i18n";

type Memory = { id: number; agent_id: string | null; content: string; type: string; updated_at: number };

/** Persistent notes the agents keep (memory.* from context-memory-db): list, add, edit, remove. */
export function MemoryPage() {
  const { call, connected } = useGateway();
  const t = useT();
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [newContent, setNewContent] = useState("");
  const [editing, setEditing] = useState<{ id: number; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await call<{ memories: Memory[] }>("memory.list", { limit: 500 });
      setMemories(res.memories);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMemories([]);
    }
  }, [call]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="page">
      <h1>{t("nav.memory")}</h1>
      <p className="muted">{t("memory.intro")}</p>
      {error && <p className="error">{error}</p>}
      <form
        className="card row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newContent.trim()) return;
          void run(() => call("memory.add", { content: newContent.trim() })).then(() => setNewContent(""));
        }}
      >
        <input value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder={t("memory.placeholder")} className="grow" />
        <button type="submit" disabled={!newContent.trim()}>
          {t("memory.add")}
        </button>
      </form>
      {memories === null ? (
        <p className="muted">{t("common.loading")}</p>
      ) : memories.length === 0 ? (
        <p className="muted">{t("memory.empty")}</p>
      ) : (
        <ul className="card-list">
          {memories.map((m) => (
            <li key={m.id} className="card">
              {editing?.id === m.id ? (
                <>
                  <textarea className="editor small" value={editing.content} onChange={(e) => setEditing({ id: m.id, content: e.target.value })} />
                  <div className="row">
                    <button type="button" onClick={() => void run(() => call("memory.update", { id: m.id, content: editing.content })).then(() => setEditing(null))}>
                      {t("common.save")}
                    </button>
                    <button type="button" className="secondary" onClick={() => setEditing(null)}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="memory-content">{m.content}</p>
                  <div className="row memory-meta">
                    <span className="muted">
                      {m.type}
                      {m.agent_id ? ` · ${m.agent_id}` : ""} · {new Date(m.updated_at).toLocaleString()}
                    </span>
                    <span className="grow" />
                    <button type="button" className="secondary" onClick={() => setEditing({ id: m.id, content: m.content })}>
                      {t("common.edit")}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        if (window.confirm(t("memory.confirmRemove"))) void run(() => call("memory.remove", { id: m.id }));
                      }}
                    >
                      {t("common.remove")}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
