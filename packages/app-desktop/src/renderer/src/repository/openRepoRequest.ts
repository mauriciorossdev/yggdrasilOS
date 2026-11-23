import { useSyncExternalStore } from "react";

// "Review changes" in the Worktrees tab opens that worktree in the Repositorio
// tab. git.repos leaves linked worktrees out on purpose (they're the Worktrees
// tab's business), so the request carries what the selector needs to list it.

export type OpenRepoRequest = { path: string; name: string; branch?: string; nonce: number };

let request: OpenRepoRequest | null = null;
let nonce = 0;
const listeners = new Set<() => void>();

/** `path` is project-relative, as git.* methods take `repo`. */
export function requestOpenRepo(path: string, name: string, branch?: string): void {
  request = { path, name, branch, nonce: ++nonce };
  listeners.forEach((fn) => fn());
}

/** The Repositorio tab took the request: a later mount must not jump back to that worktree. */
export function consumeOpenRepoRequest(nonceSeen: number): void {
  if (request?.nonce === nonceSeen) request = null;
}

export function useOpenRepoRequest(): OpenRepoRequest | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => request,
  );
}
