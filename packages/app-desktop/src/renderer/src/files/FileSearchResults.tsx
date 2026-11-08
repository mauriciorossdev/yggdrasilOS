import { Fragment, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { EntryIcon } from "./FileIcons.js";
import { highlightQuery, splitAt, type HighlightPart } from "./highlight.js";
import { useI18n } from "../i18n/index.js";

type NameResult = { relativePath: string; type: "file" | "directory" };

type Snippet = { line: number; text: string; matchStart: number; matchEnd: number };
type ContentResult = { relativePath: string; nameMatch: boolean; matches: number; snippets: Snippet[] };

/** What a search hit asks the opened note to show: the text that matched and the line it was on. */
export type OpenTarget = { query: string; line?: number };

type Props = {
  query: string;
  onOpenFile: (relativePath: string, target?: OpenTarget) => void;
  /** Search what the files say too, with a snippet of each hit (fs.searchContent). Default: names only (fs.search). */
  content?: boolean;
  /** Folder (relative to the project) to search in; only used with `content`. */
  root?: string;
};

const DEBOUNCE_MS = 200;
const LIMIT = 60;
const CONTENT_LIMIT = 40;
const CONTENT_MIN_CHARS = 2;

function Marked({ parts }: { parts: HighlightPart[] }) {
  return (
    <>
      {parts.map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <Fragment key={i}>{part.text}</Fragment>))}
    </>
  );
}

/**
 * Flat list of files matching `query`, replacing the tree while the filter box has text. By default it
 * matches names (fs.search). With `content` it also looks inside the files, so each result can show
 * where the text was found, in the order: name matches, then the files that mention it most.
 */
export function FileSearchResults({ query, onOpenFile, content, root = "" }: Props) {
  const { t } = useI18n();
  const { call } = useGateway();
  const [names, setNames] = useState<NameResult[] | null>(null);
  const [hits, setHits] = useState<ContentResult[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = !!content && query.length < CONTENT_MIN_CHARS;

  useEffect(() => {
    setNames(null);
    setHits(null);
    setTruncated(false);
    setError(null);
    if (tooShort) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (content) {
        call<{ results: ContentResult[]; truncated: boolean }>("fs.searchContent", { query, root, limit: CONTENT_LIMIT })
          .then((res) => {
            if (cancelled) return;
            setHits(res.results);
            setTruncated(res.truncated);
          })
          .catch((err) => {
            if (!cancelled) setError(err instanceof Error ? err.message : String(err));
          });
      } else {
        call<{ entries: NameResult[] }>("fs.search", { query, limit: LIMIT })
          .then((res) => {
            if (!cancelled) setNames(res.entries.filter((e) => e.type === "file"));
          })
          .catch((err) => {
            if (!cancelled) setError(err instanceof Error ? err.message : String(err));
          });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [call, query, content, root, tooShort]);

  if (error) return <p className="error">{error}</p>;
  if (tooShort) return <p className="muted">Escribe al menos {CONTENT_MIN_CHARS} letras para buscar en el contenido.</p>;

  if (content) {
    if (hits === null) return <p className="muted">{t("doc.search.searching")}</p>;
    if (hits.length === 0) return <p className="muted">{t("doc.search.noNotes", { query })}</p>;
    return (
      <div className="file-search-results">
        <div className="file-search-count-line">
          {t(hits.length === 1 ? "doc.search.countOne" : "doc.search.count", { count: hits.length })}
          {truncated ? t("doc.search.truncated") : ""}
        </div>
        {hits.map((hit) => {
          const slash = hit.relativePath.lastIndexOf("/");
          const name = hit.relativePath.slice(slash + 1);
          const dir = slash === -1 ? "" : hit.relativePath.slice(0, slash);
          return (
            <button
              key={hit.relativePath}
              type="button"
              className="file-search-hit"
              title={hit.relativePath}
              onClick={() => onOpenFile(hit.relativePath, hit.matches > 0 ? { query, line: hit.snippets[0]?.line } : undefined)}
            >
              <span className="file-search-hit-head">
                <span className="file-node-icon">
                  <EntryIcon name={name} isDir={false} />
                </span>
                <span className="file-node-name">
                  <Marked parts={highlightQuery(name, query)} />
                </span>
                {hit.matches > 0 && <span className="file-search-hit-count">{hit.matches}</span>}
              </span>
              {dir && <span className="file-search-hit-path">{dir}</span>}
              {hit.snippets.map((s) => (
                <span key={s.line} className="file-search-snippet">
                  <i>{s.line}</i>
                  <span>
                    <Marked parts={splitAt(s.text, s.matchStart, s.matchEnd)} />
                  </span>
                </span>
              ))}
            </button>
          );
        })}
      </div>
    );
  }

  if (names === null) return <p className="muted">{t("doc.search.searching")}</p>;
  if (names.length === 0) return <p className="muted">{t("doc.search.noFiles", { query })}</p>;
  return (
    <div className="file-search-results">
      {names.map((r) => {
        const name = r.relativePath.slice(r.relativePath.lastIndexOf("/") + 1);
        return (
          <button
            key={r.relativePath}
            type="button"
            className="file-node-row file-search-row"
            title={r.relativePath}
            onClick={() => onOpenFile(r.relativePath)}
          >
            <span className="file-node-icon">
              <EntryIcon name={name} isDir={false} />
            </span>
            <span className="file-node-name">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
