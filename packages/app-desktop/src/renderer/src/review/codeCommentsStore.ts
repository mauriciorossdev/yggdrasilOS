import { useEffect, useSyncExternalStore } from "react";
import type { CodeComment } from "../types.js";

// Review comments per repo/worktree root, fetched from main and refreshed when
// main says they changed (added, sent, resolved by an agent). Module-level so
// the review bar and every editor showing a file of that repo share one copy.

const EMPTY: CodeComment[] = [];
const byRoot = new Map<string, CodeComment[]>();
const listeners = new Set<() => void>();
let subscribed = false;

function emit(): void {
  listeners.forEach((fn) => fn());
}

export async function refreshCodeComments(root: string): Promise<void> {
  try {
    byRoot.set(root, await window.yggdrasil.codeComments.list(root));
  } catch {
    byRoot.set(root, EMPTY);
  }
  emit();
}

function subscribe(fn: () => void): () => void {
  if (!subscribed && window.yggdrasil.projectId) {
    subscribed = true;
    window.yggdrasil.codeComments.onChanged((root) => {
      if (byRoot.has(root)) void refreshCodeComments(root);
    });
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useCodeComments(root: string | undefined): CodeComment[] {
  useEffect(() => {
    if (root && !byRoot.has(root)) void refreshCodeComments(root);
  }, [root]);
  return useSyncExternalStore(subscribe, () => (root ? (byRoot.get(root) ?? EMPTY) : EMPTY));
}

// "Hide resolved" toggle of the review bar, shared by the cards of every editor in this window.
let hideDone = false;
export function setHideDoneComments(next: boolean): void {
  hideDone = next;
  emit();
}
export function useHideDoneComments(): boolean {
  return useSyncExternalStore(subscribe, () => hideDone);
}

// A click in the comment list asks the editor showing that file to scroll to the comment.
type Reveal = { root: string; path: string; id: string; nonce: number };
let reveal: Reveal | null = null;
let nonce = 0;
export function requestRevealComment(root: string, path: string, id: string): void {
  reveal = { root, path, id, nonce: ++nonce };
  emit();
}
export function useRevealRequest(): Reveal | null {
  return useSyncExternalStore(subscribe, () => reveal);
}
