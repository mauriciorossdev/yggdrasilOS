import { useCallback, useEffect, useMemo, useState } from "react";
import { LockClosedIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import { Modal, Tabs } from "../ui/index.js";
import { useI18n } from "../i18n/index.js";
import { filterRepos, gatewayErrorMessage, ipcErrorMessage, suggestFolderName, type GithubRepoItem } from "./cloneRepo.js";

type GithubStatus = { connected: boolean; login?: string };
type Tab = "github" | "url";

type Props = {
  onClose: () => void;
  /** The clone was registered and its window opened. */
  onCloned: () => void;
  /** "Connect GitHub": the Home opens Settings → Connectors. */
  onOpenConnectors: () => void;
};

const PER_PAGE = 50;

/**
 * Home → "Clone repository": pick one of the connected GitHub account's repos
 * (connectors.github.* on this window's gateway) or paste any git URL. Both
 * end in projects.cloneRepo, which clones into <location>/<folder>, registers
 * the folder as a project and opens it.
 */
export function CloneRepoDialog({ onClose, onCloned, onOpenConnectors }: Props) {
  const { t } = useI18n();
  const { call } = useGateway();
  const [tab, setTab] = useState<Tab>("github");

  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [repos, setRepos] = useState<GithubRepoItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GithubRepoItem | null>(null);

  const [url, setUrl] = useState("");
  const [folder, setFolder] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.yggdrasil.projects.cloneDefaultParent().then(setParentDir);
  }, []);

  const loadRepos = useCallback(
    async (nextPage: number) => {
      setLoadingRepos(true);
      setListError(null);
      try {
        const res = await call<{ repos: GithubRepoItem[]; hasMore: boolean }>("connectors.github.listRepos", {
          page: nextPage,
          perPage: PER_PAGE,
        });
        setRepos((prev) => (nextPage === 1 ? res.repos : [...prev, ...res.repos]));
        setPage(nextPage);
        setHasMore(res.hasMore);
      } catch (err) {
        setListError(gatewayErrorMessage(err));
      } finally {
        setLoadingRepos(false);
      }
    },
    [call],
  );

  useEffect(() => {
    let cancelled = false;
    call<GithubStatus>("connectors.github.status")
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        // Nothing to pick from without an account: start where something works.
        if (s.connected) void loadRepos(1);
        else setTab("url");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus({ connected: false });
        setStatusError(gatewayErrorMessage(err));
        setTab("url");
      });
    return () => {
      cancelled = true;
    };
  }, [call, loadRepos]);

  const visibleRepos = useMemo(() => filterRepos(repos, query), [repos, query]);
  const cloneUrl = tab === "github" ? (selected?.cloneUrl ?? "") : url.trim();
  const suggestedFolder = tab === "github" ? (selected?.name ?? "") : suggestFolderName(url);
  const canClone = cloneUrl !== "" && !busy;

  const pickLocation = async () => {
    const dir = await window.yggdrasil.dialog.openDirectory();
    if (dir) setParentDir(dir);
  };

  /** `repo` overrides the selection (double-click fires before setSelected lands). */
  const submit = async (repo?: GithubRepoItem) => {
    const target = repo ? repo.cloneUrl : cloneUrl;
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.yggdrasil.projects.cloneRepo({
        url: target,
        parentDir: parentDir || undefined,
        folderName: folder.trim() || undefined,
      });
      onCloned();
      onClose();
    } catch (err) {
      setError(ipcErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("home.clone.title")}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="repo-btn" onClick={onClose} disabled={busy}>
            {t("home.clone.cancel")}
          </button>
          <button type="button" className="repo-btn primary" onClick={() => void submit()} disabled={!canClone}>
            {busy ? t("home.clone.cloning") : t("home.clone.submit")}
          </button>
        </>
      }
    >
      <div className="home-clone">
        <Tabs
          tabs={[
            { id: "github", label: t("home.clone.tabGithub") },
            { id: "url", label: t("home.clone.tabUrl") },
          ]}
          active={tab}
          onSelect={(id) => {
            setTab(id as Tab);
            setError(null);
          }}
        />

        {tab === "github" && (
          <div className="home-clone-pane">
            {status === null && (
              <div className="home-clone-loading" role="status">
                <span className="spinner" aria-hidden="true" />
                {t("home.clone.loadingStatus")}
              </div>
            )}
            {status && !status.connected && (
              <div className="home-clone-connect">
                <p className="muted">{t("home.clone.notConnected")}</p>
                {statusError && <p className="error">{statusError}</p>}
                <button type="button" className="repo-btn primary" onClick={onOpenConnectors}>
                  {t("home.clone.connect")}
                </button>
              </div>
            )}
            {status?.connected && (
              <>
                <div className="home-clone-repo-head">
                  <input
                    type="search"
                    className="repo-input"
                    placeholder={t("home.clone.searchRepos")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                  />
                  {status.login && <span className="muted home-clone-login">{t("home.clone.connectedAs", { login: status.login })}</span>}
                </div>
                {listError && (
                  <div className="home-clone-list-error">
                    <p className="error">{listError}</p>
                    <button type="button" className="repo-btn small" onClick={() => void loadRepos(repos.length === 0 ? 1 : page + 1)}>
                      {t("home.clone.retry")}
                    </button>
                  </div>
                )}
                <div className="home-clone-repos" role="listbox" aria-label={t("home.clone.tabGithub")}>
                  {visibleRepos.map((repo) => (
                    <button
                      key={repo.fullName}
                      type="button"
                      role="option"
                      aria-selected={selected?.fullName === repo.fullName}
                      className={`home-clone-repo${selected?.fullName === repo.fullName ? " selected" : ""}`}
                      onClick={() => setSelected(repo)}
                      onDoubleClick={() => {
                        setSelected(repo);
                        void submit(repo);
                      }}
                      disabled={busy}
                    >
                      <span className="home-clone-repo-name">
                        {repo.fullName}
                        {repo.private && (
                          <span className="home-clone-badge">
                            <LockClosedIcon className="hero-icon" /> {t("home.clone.private")}
                          </span>
                        )}
                        {repo.fork && <span className="home-clone-badge">{t("home.clone.fork")}</span>}
                      </span>
                      {repo.description && <span className="home-clone-repo-desc">{repo.description}</span>}
                    </button>
                  ))}
                  {loadingRepos && repos.length === 0 && (
                    <div className="home-clone-loading" role="status">
                      <span className="spinner" aria-hidden="true" />
                      {t("home.clone.loadingRepos")}
                    </div>
                  )}
                  {!loadingRepos && !listError && visibleRepos.length === 0 && <p className="muted">{t("home.clone.noRepos")}</p>}
                  {!listError && hasMore && repos.length > 0 && (
                    <button
                      type="button"
                      className="repo-btn small"
                      onClick={() => void loadRepos(page + 1)}
                      disabled={loadingRepos}
                      aria-busy={loadingRepos}
                    >
                      {loadingRepos && <span className="spinner" aria-hidden="true" />}
                      {loadingRepos ? t("home.clone.loadingRepos") : t("home.clone.loadMore")}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "url" && (
          <div className="home-clone-pane wt-form">
            <label>
              {t("home.clone.urlLabel")}
              <input
                className="repo-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                placeholder={t("home.clone.urlPlaceholder")}
                spellCheck={false}
                autoFocus
              />
            </label>
            <p className="muted home-clone-hint">{t("home.clone.urlHint")}</p>
          </div>
        )}

        {(tab === "url" || status?.connected) && (
          <div className="wt-form home-clone-target">
            <label>
              {t("home.clone.folder")}
              <input
                className="repo-input"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder={suggestedFolder}
                spellCheck={false}
                disabled={busy}
              />
            </label>
            <label>
              {t("home.clone.location")}
              <span className="home-clone-location">
                <input className="repo-input" value={parentDir} readOnly title={parentDir} />
                <button type="button" className="repo-btn" onClick={() => void pickLocation()} disabled={busy}>
                  {t("home.clone.change")}
                </button>
              </span>
            </label>
          </div>
        )}

        {error &&<p className="error home-clone-error">{error}</p>}
      </div>
    </Modal>
  );
}
