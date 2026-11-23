import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useGateway } from "@yggdrasil/client-web";
import { Markdown } from "@yggdrasil/ui-kit";
import { useT } from "../i18n";

type Entry = { name: string; type: "directory" | "file" | "other" };

/** Browse the project folder and view files (read-only). fs.* only answers this machine or a trusted device. */
export function FilesPage() {
  const { call, connected } = useGateway();
  const t = useT();
  const [params, setParams] = useSearchParams();
  const dir = params.get("dir") ?? "";
  const file = params.get("file");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [content, setContent] = useState<{ text: string; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    setEntries(null);
    call<{ entries: Entry[] }>("fs.list", { relativePath: dir })
      .then((r) =>
        setEntries(
          [...r.entries].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1)),
        ),
      )
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setEntries([]);
      });
  }, [connected, dir, call]);

  useEffect(() => {
    setContent(null);
    if (!connected || !file) return;
    call<{ content: string; truncated: boolean }>("fs.read", { relativePath: file })
      .then((r) => setContent({ text: r.content, truncated: r.truncated }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [connected, file, call]);

  const join = (name: string) => (dir ? `${dir}/${name}` : name);
  const crumbs = dir ? dir.split("/") : [];

  return (
    <div className="page">
      <h1>{t("nav.files")}</h1>
      {error && <p className="error">{error}</p>}
      <div className="row crumbs">
        <button type="button" className="link-btn" onClick={() => setParams({})}>
          {t("files.root")}
        </button>
        {crumbs.map((c, i) => (
          <span key={i}>
            {" / "}
            <button type="button" className="link-btn" onClick={() => setParams({ dir: crumbs.slice(0, i + 1).join("/") })}>
              {c}
            </button>
          </span>
        ))}
      </div>
      <div className="split">
        <aside className="card list-pane">
          {entries === null ? (
            <p className="muted">{t("common.loading")}</p>
          ) : (
            <ul className="pick-list">
              {entries.map((e) => (
                <li key={e.name}>
                  <button
                    type="button"
                    className={`pick-item row-item${file === join(e.name) ? " active" : ""}`}
                    onClick={() => (e.type === "directory" ? setParams({ dir: join(e.name) }) : setParams({ dir, file: join(e.name) }))}
                  >
                    <span className="mono">
                      {e.type === "directory" ? "▸ " : ""}
                      {e.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="card detail-pane">
          {!file ? (
            <p className="muted">{t("files.pick")}</p>
          ) : content === null ? (
            <p className="muted">{t("common.loading")}</p>
          ) : (
            <>
              <p className="mono muted">{file}</p>
              {content.truncated && <p className="muted">{t("files.truncated")}</p>}
              {file.endsWith(".md") ? (
                <div className="markdown-body">
                  <Markdown text={content.text} />
                </div>
              ) : (
                <pre className="code-view">{content.text}</pre>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
