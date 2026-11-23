import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useGateway } from "@yggdrasil/client-web";
import { Markdown } from "@yggdrasil/ui-kit";
import { useT } from "../i18n";

type NoteEntry = { path: string; title: string };

/**
 * The project's notes folder (notes/, the desktop app's Documents): list, read as
 * markdown, edit and create. fs.* only answers this machine or a trusted device.
 */
export function DocumentsPage() {
  const { call, connected } = useGateway();
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selected = params.get("path");

  const refresh = useCallback(async () => {
    try {
      const res = await call<{ notes: NoteEntry[] }>("documents.index", { root: "notes" });
      setNotes([...res.notes].sort((a, b) => a.path.localeCompare(b.path)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [call]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  useEffect(() => {
    setDraft(null);
    setContent(null);
    if (!connected || !selected) return;
    call<{ content: string }>("fs.read", { relativePath: selected })
      .then((r) => setContent(r.content))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [connected, selected, call]);

  const save = async () => {
    if (!selected || draft === null) return;
    await call("fs.write", { relativePath: selected, content: draft });
    setContent(draft);
    setDraft(null);
    void refresh();
  };

  const create = async () => {
    const slug = newName.trim().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, "-");
    if (!slug) return;
    const path = `notes/${slug}.md`;
    await call("fs.write", { relativePath: path, content: `# ${newName.trim()}\n` });
    setNewName("");
    await refresh();
    setParams({ path });
  };

  return (
    <div className="page docs-page">
      <h1>{t("nav.documents")}</h1>
      {error && <p className="error">{error}</p>}
      <div className="split">
        <aside className="card list-pane">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input className="grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("docs.newPlaceholder")} />
            <button type="submit" disabled={!newName.trim()}>
              {t("docs.create")}
            </button>
          </form>
          {notes.length === 0 ? (
            <p className="muted">{t("docs.empty")}</p>
          ) : (
            <ul className="pick-list">
              {notes.map((n) => (
                <li key={n.path}>
                  <button
                    type="button"
                    className={`pick-item${n.path === selected ? " active" : ""}`}
                    onClick={() => setParams({ path: n.path })}
                    title={n.path}
                  >
                    <span>{n.title}</span>
                    <span className="muted pick-sub">{n.path.replace(/^notes\//, "")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="card detail-pane">
          {!selected ? (
            <p className="muted">{t("docs.pick")}</p>
          ) : content === null ? (
            <p className="muted">{t("common.loading")}</p>
          ) : draft !== null ? (
            <>
              <textarea className="editor" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <div className="row">
                <button type="button" onClick={() => void save()}>
                  {t("common.save")}
                </button>
                <button type="button" className="secondary" onClick={() => setDraft(null)}>
                  {t("common.cancel")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="row detail-actions">
                <span className="muted">{selected}</span>
                <button type="button" className="secondary" onClick={() => setDraft(content)}>
                  {t("common.edit")}
                </button>
              </div>
              <div className="markdown-body">
                <Markdown text={content} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
