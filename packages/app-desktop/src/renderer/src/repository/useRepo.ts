import { useCallback, useEffect, useRef, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { BranchInfo, CommitInfo, RemoteInfo, RepoInfo, RepoStatus, StashInfo } from "./types.js";

const LOG_PAGE = 100;
const REFRESH_DEBOUNCE_MS = 600;

type ReposResult = { workspaceRoot: string; repos: RepoInfo[] };

/**
 * State + actions for the Repositorio tab. One selected repo at a time
 * (`repo` is the path relative to the project root, as returned by git.repos);
 * every mutation goes through `run`, which serializes calls, surfaces git's own
 * error text, and refreshes afterwards.
 */
export function useRepo() {
  const { call, onEvent } = useGateway();
  const [repos, setRepos] = useState<RepoInfo[] | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [stashes, setStashes] = useState<StashInfo[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ method: string; message: string } | null>(null);
  const [version, setVersion] = useState(0);
  const repoRef = useRef<string | null>(null);
  repoRef.current = repo;

  const loadRepos = useCallback(async () => {
    try {
      const res = await call<ReposResult>("git.repos", {});
      setRepos(res.repos);
      setRepo((current) => {
        if (current && res.repos.some((r) => r.path === current)) return current;
        return res.repos[0]?.path ?? null;
      });
    } catch (err) {
      setRepos([]);
      setError({ method: "git.repos", message: err instanceof Error ? err.message : String(err) });
    }
  }, [call]);

  const loadRepoState = useCallback(async () => {
    const current = repoRef.current;
    if (current === null) {
      setStatus(null);
      setBranches([]);
      setCommits([]);
      setStashes([]);
      setRemotes([]);
      return;
    }
    try {
      const [st, br, lg, sh, rm] = await Promise.all([
        call<RepoStatus>("git.status2", { repo: current }),
        call<{ branches: BranchInfo[] }>("git.branches", { repo: current }),
        call<{ commits: CommitInfo[]; hasMore: boolean }>("git.log", { repo: current, limit: LOG_PAGE }),
        call<{ stashes: StashInfo[] }>("git.stashList", { repo: current }),
        call<{ remotes: RemoteInfo[] }>("git.remotes", { repo: current }),
      ]);
      if (repoRef.current !== current) return; // user switched repos mid-flight
      setStatus(st);
      setBranches(br.branches);
      setCommits(lg.commits);
      setHasMore(lg.hasMore);
      setStashes(sh.stashes);
      setRemotes(rm.remotes);
      setVersion((v) => v + 1);
    } catch (err) {
      setError({ method: "refresh", message: err instanceof Error ? err.message : String(err) });
    }
  }, [call]);

  useEffect(() => {
    void loadRepos();
  }, [loadRepos]);

  useEffect(() => {
    void loadRepoState();
  }, [repo, loadRepoState]);

  // Debounced live refresh: fs.changed fires for every write under the project
  // (including .git internals' parents), so coalesce bursts into one reload.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onEvent((ev) => {
      if (ev.event !== "fs.changed") return;
      clearTimeout(timer);
      timer = setTimeout(() => void loadRepoState(), REFRESH_DEBOUNCE_MS);
    });
    const onFocus = () => void loadRepoState();
    window.addEventListener("focus", onFocus);
    return () => {
      off();
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [onEvent, loadRepoState]);

  const run = useCallback(
    async <T = unknown>(method: string, params: Record<string, unknown> = {}, label?: string): Promise<T | null> => {
      if (repoRef.current === null && method !== "git.init") return null;
      setBusy(label ?? method);
      setError(null);
      try {
        const res = await call<T>(method, { repo: repoRef.current, ...params });
        if (method === "git.init") await loadRepos();
        await loadRepoState();
        return res;
      } catch (err) {
        setError({ method, message: err instanceof Error ? err.message : String(err) });
        await loadRepoState();
        return null;
      } finally {
        setBusy(null);
      }
    },
    [call, loadRepoState, loadRepos],
  );

  const loadMore = useCallback(async () => {
    const current = repoRef.current;
    if (current === null) return;
    try {
      const res = await call<{ commits: CommitInfo[]; hasMore: boolean }>("git.log", {
        repo: current,
        limit: LOG_PAGE,
        skip: commits.length,
      });
      setCommits((prev) => [...prev, ...res.commits]);
      setHasMore(res.hasMore);
    } catch (err) {
      setError({ method: "git.log", message: err instanceof Error ? err.message : String(err) });
    }
  }, [call, commits.length]);

  return {
    call,
    repos,
    repo,
    setRepo,
    status,
    branches,
    commits,
    hasMore,
    stashes,
    remotes,
    busy,
    error,
    clearError: () => setError(null),
    version,
    run,
    loadMore,
    reload: async () => {
      await loadRepos();
      await loadRepoState();
    },
  };
}
