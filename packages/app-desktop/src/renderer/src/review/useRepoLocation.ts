import { useEffect, useState } from "react";
import type { RepoLocation } from "../types.js";

/** The repo/worktree that holds a project path (a repo folder or a file), resolved by main. Undefined until known or outside git. */
export function useRepoLocation(target: string | null | undefined): RepoLocation | undefined {
  const [loc, setLoc] = useState<{ target: string; value: RepoLocation | undefined }>();
  useEffect(() => {
    if (!target || !window.yggdrasil.projectId) return;
    let cancelled = false;
    window.yggdrasil.codeComments
      .locate(target)
      .then((value) => !cancelled && setLoc({ target, value }))
      .catch(() => !cancelled && setLoc({ target, value: undefined }));
    return () => {
      cancelled = true;
    };
  }, [target]);
  return target && loc?.target === target ? loc.value : undefined;
}
