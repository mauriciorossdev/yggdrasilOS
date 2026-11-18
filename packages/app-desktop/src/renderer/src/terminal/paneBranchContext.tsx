import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { branchForCwd, type Checkout } from "./paneBranch.js";
import { onTerminalTabVisible } from "./terminalBridge.js";

const REFRESH_MS = 5000;
const MAX_REPOS = 6;

type ReposResult = { workspaceRoot: string; repos: Array<{ path: string }> };
type CheckoutsResult = { checkouts: Checkout[] };

type CheckoutsState = {
  checkouts: Checkout[];
  /** Linked worktrees across the project's repos (every checkout but each repo's main one). */
  worktreeCount: number;
};

const BranchContext = createContext<CheckoutsState>({ checkouts: [], worktreeCount: 0 });

/**
 * Every checkout (repo working copies and their linked worktrees) of the project, kept fresh while the
 * window is visible. Mounted around the whole chat shell: the terminals show each pane's branch, the
 * sidebar's Worktrees entry shows the count.
 */
export function PaneBranchProvider({ children }: { children: ReactNode }) {
  const { call } = useGateway();
  const [checkouts, setCheckouts] = useState<Checkout[]>([]);
  const [worktreeCount, setWorktreeCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const { repos } = await call<ReposResult>("git.repos", {});
      const lists = await Promise.all(
        repos.slice(0, MAX_REPOS).map((r) => call<CheckoutsResult>("git.checkouts", { repo: r.path })),
      );
      const next = lists.flatMap((l) => l.checkouts);
      setCheckouts((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      // `git worktree list` always prints the main checkout first.
      setWorktreeCount(lists.reduce((n, l) => n + Math.max(0, l.checkouts.length - 1), 0));
    } catch {
      // Not a git project (or the gateway is unreachable): the panes simply show no branch.
    }
  }, [call]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    const off = onTerminalTabVisible(() => void load());
    return () => {
      window.clearInterval(timer);
      off();
    };
  }, [load]);

  const value = useMemo(() => ({ checkouts, worktreeCount }), [checkouts, worktreeCount]);
  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

/** How many linked worktrees the project's repos have (0 when it isn't a git project). */
export function useWorktreeCount(): number {
  return useContext(BranchContext).worktreeCount;
}

/** The branch the terminal opened at `cwd` is on, if that folder is inside a git checkout. */
export function usePaneBranch(cwd: string | undefined): string | undefined {
  const { checkouts } = useContext(BranchContext);
  return useMemo(() => branchForCwd(checkouts, cwd), [checkouts, cwd]);
}
