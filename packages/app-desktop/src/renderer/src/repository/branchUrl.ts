import type { BranchInfo, RemoteInfo } from "./types.js";

export type Provider = "github" | "gitlab" | "bitbucket";
export type RemoteWeb = { provider: Provider; /** https://host/owner/repo */ base: string };

/** Splits a git remote URL (https, ssh://, scp-like `git@host:owner/repo.git`) into host + repo path; credentials, port and `.git` are dropped. */
export function parseRemoteUrl(url: string): { host: string; path: string } | null {
  const trimmed = url.trim();
  let host: string;
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      host = u.hostname;
      path = u.pathname;
    } catch {
      return null;
    }
  } else {
    const m = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(trimmed);
    if (!m) return null;
    host = m[1];
    path = m[2];
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  if (!host || path.split("/").filter(Boolean).length < 2) return null;
  return { host: host.toLowerCase(), path };
}

function detectProvider(host: string): Provider | null {
  if (host.includes("github")) return "github";
  if (host.includes("gitlab")) return "gitlab";
  if (host.includes("bitbucket")) return "bitbucket";
  return null;
}

/** Web base URL + provider for a remote, or null when it can't be linked (unknown host, e.g. Azure DevOps). */
export function remoteWeb(url: string): RemoteWeb | null {
  const parsed = parseRemoteUrl(url);
  if (!parsed) return null;
  const provider = detectProvider(parsed.host);
  if (!provider) return null;
  return { provider, base: `https://${parsed.host}/${parsed.path}` };
}

// Branch names may contain "/" (feat/x) — keep it as a path separator, encode the rest.
const encodeBranch = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");

export function branchUrl(web: RemoteWeb, branch: string): string {
  const b = encodeBranch(branch);
  if (web.provider === "github") return `${web.base}/tree/${b}`;
  if (web.provider === "gitlab") return `${web.base}/-/tree/${b}`;
  return `${web.base}/src/${b}`;
}

/** "Open a PR/MR" page for the branch. */
export function compareUrl(web: RemoteWeb, branch: string): string {
  if (web.provider === "github") return `${web.base}/compare/${encodeBranch(branch)}?expand=1`;
  if (web.provider === "gitlab") return `${web.base}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}`;
  return `${web.base}/pull-requests/new?source=${encodeURIComponent(branch)}`;
}

/**
 * Which remote + remote branch name a branch lives on: "origin/x" → origin/x;
 * a local branch → its upstream. A local branch with no upstream isn't
 * published anywhere, so there is nothing to link to (null).
 */
export function branchRemoteTarget(
  branch: Pick<BranchInfo, "name" | "remote" | "upstream">,
  remotes: RemoteInfo[],
): { remote: RemoteInfo; branch: string } | null {
  const ref = branch.remote ? branch.name : branch.upstream;
  if (!ref) return null;
  // Longest remote name first, so "origin" doesn't shadow a remote called "origin/mirror".
  const sorted = [...remotes].sort((a, b) => b.name.length - a.name.length);
  for (const remote of sorted) {
    if (ref.startsWith(`${remote.name}/`)) return { remote, branch: ref.slice(remote.name.length + 1) };
  }
  return null;
}
