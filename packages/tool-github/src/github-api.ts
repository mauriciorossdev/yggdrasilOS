const API = "https://api.github.com";

export async function githubFetch(path: string, accessToken: string): Promise<{ data: unknown; next: boolean }> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "yggdrasil",
    },
  });
  if (res.status === 401) {
    throw new Error("GitHub rejected the stored token (revoked or expired) — reconnect GitHub in Settings → Connectors.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} for ${path}: ${text.slice(0, 500)}`);
  }
  return { data: await res.json(), next: /rel="next"/.test(res.headers.get("link") ?? "") };
}

export type GithubRepo = {
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  defaultBranch: string;
  cloneUrl: string;
  htmlUrl: string;
  updatedAt: string;
};

type RawRepo = {
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  private: boolean;
  fork: boolean;
  default_branch: string;
  clone_url: string;
  html_url: string;
  pushed_at: string | null;
  updated_at: string;
};

export function mapRepo(r: RawRepo): GithubRepo {
  return {
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    description: r.description,
    private: r.private,
    fork: r.fork,
    defaultBranch: r.default_branch,
    cloneUrl: r.clone_url,
    htmlUrl: r.html_url,
    updatedAt: r.pushed_at ?? r.updated_at,
  };
}

export async function getAuthenticatedLogin(accessToken: string): Promise<string> {
  const { data } = await githubFetch("/user", accessToken);
  return (data as { login: string }).login;
}

/** The authenticated user's repos (owned, collaborator and org member), most recently pushed first. */
export async function listRepos(
  accessToken: string,
  params: { page?: number; perPage?: number } = {},
): Promise<{ repos: GithubRepo[]; hasMore: boolean }> {
  const query = new URLSearchParams({
    sort: "pushed",
    direction: "desc",
    affiliation: "owner,collaborator,organization_member",
    per_page: String(Math.min(Math.max(params.perPage ?? 30, 1), 100)),
    page: String(Math.max(params.page ?? 1, 1)),
  });
  const { data, next } = await githubFetch(`/user/repos?${query}`, accessToken);
  return { repos: (data as RawRepo[]).map(mapRepo), hasMore: next };
}

/** Looks one repo up by "owner/name" — used by clone so a hand-typed repo is validated against the API, not just trusted as a URL. */
export async function getRepo(accessToken: string, fullName: string): Promise<GithubRepo> {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(fullName)) {
    throw new Error(`Invalid repo "${fullName}" — expected "owner/name".`);
  }
  const { data } = await githubFetch(`/repos/${fullName}`, accessToken);
  return mapRepo(data as RawRepo);
}
