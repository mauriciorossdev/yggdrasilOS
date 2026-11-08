import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { GitStatusResult } from "../types.js";
import { buildGitDecor, EMPTY_GIT_DECOR, type GitDecor } from "./gitDecor.js";

const REFRESH_DEBOUNCE_MS = 500;

/**
 * The project's git status for the sidebar: how many changes (the Remote
 * Diff badge) and what the file tree decorates. Refreshes, debounced, when
 * files are added/removed or edited; RemoteFilesPanel does its own fetch for
 * the full list and diffs.
 */
export function useGitChanges(): { isRepo: boolean; count: number; decor: GitDecor } {
  const { call, onEvent, authenticated } = useGateway();
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setStatus(await call<GitStatusResult>("git.status", {}));
    } catch {
      setStatus(null);
    }
  }, [call]);

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated, load]);

  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.event !== "fs.changed" && ev.event !== "fs.contentChanged") return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void load(), REFRESH_DEBOUNCE_MS);
      }),
    [onEvent, load],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const decor = useMemo(() => (status?.isRepo ? buildGitDecor(status.files) : EMPTY_GIT_DECOR), [status]);
  return { isRepo: status?.isRepo ?? false, count: status?.files.length ?? 0, decor };
}
