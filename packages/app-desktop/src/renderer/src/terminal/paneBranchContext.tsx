import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { branchForCwd, type Checkout } from "./paneBranch.js";
import { onTerminalTabVisible } from "./terminalBridge.js";

const REFRESH_MS = 5000;
const MAX_REPOS = 6;

type ReposResult = { workspaceRoot: string; repos: Array<{ path: string }> };
type CheckoutsResult = { checkouts: Checkout[] };

const BranchContext = createContext<Checkout[]>([]);

/** Every checkout (repo working copies and their linked worktrees) of the project, kept fresh while the window is visible. */
export function PaneBranchProvider({ children }: { children: ReactNode }) {
  const { call } = useGateway();
  const [checkouts, setCheckouts] = useState<Checkout[]>([]);

  const load = useCallback(async () => {
    try {
      const { repos } = await call<ReposResult>("git.repos", {});
      const lists = await Promise.all(
        repos.slice(0, MAX_REPOS).map((r) => call<CheckoutsResult>("git.checkouts", { repo: r.path })),
      );
      const next = lists.flatMap((l) => l.checkouts);
      setCheckouts((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
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

  return <BranchContext.Provider value={checkouts}>{children}</BranchContext.Provider>;
}

/** The branch the terminal opened at `cwd` is on, if that folder is inside a git checkout. */
export function usePaneBranch(cwd: string | undefined): string | undefined {
  const checkouts = useContext(BranchContext);
  return useMemo(() => branchForCwd(checkouts, cwd), [checkouts, cwd]);
}
