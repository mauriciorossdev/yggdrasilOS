/** A repo from connectors.github.listRepos (tool-github's GithubRepo, the fields the Home dialog uses). */
export type GithubRepoItem = {
  fullName: string;
  name: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  cloneUrl: string;
  updatedAt: string;
};

/**
 * Folder name the clone would get by default: the URL's last path segment
 * without ".git" — the same rule main/gitClone.ts applies, kept loose here
 * since it's only the input's placeholder (main validates for real).
 */
export function suggestFolderName(url: string): string {
  const path = url
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*/, "")
    .replace(/^[^/:]*:/, "");
  const last = path.split("/").filter(Boolean).pop() ?? "";
  return last.replace(/\.git$/i, "");
}

/** Case-insensitive match on "owner/name" and the description; blank query keeps all. */
export function filterRepos(repos: GithubRepoItem[], query: string): GithubRepoItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return repos;
  return repos.filter((r) => r.fullName.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q));
}

/** Strips Electron's "Error invoking remote method 'x': Error: " wrapper from an IPC rejection. */
export function ipcErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** A gateway error without its "INTERNAL_ERROR: " code and "connectors.github: " method prefixes. */
export function gatewayErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^[A-Z][A-Z_]+:\s*/, "").replace(/^connectors\.github:\s*/, "");
}
