import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type GithubAccount = {
  accessToken: string;
  scopes: string[];
  login: string;
  connectedAt: number;
};

// Machine-wide, in the user's home — not the project's yggdrasil.config.json
// like tool-google's refresh token. A GitHub token is the user's identity,
// not a per-project setting, and a project folder is exactly the kind of
// place that gets committed/shared by accident. Overridable for tests.
export function githubAccountFile(): string {
  return process.env.YGGDRASIL_GITHUB_ACCOUNT_FILE?.trim() || join(homedir(), ".yggdrasil", "github-account.json");
}

export async function getGithubAccount(): Promise<GithubAccount | null> {
  try {
    const raw = JSON.parse(await readFile(githubAccountFile(), "utf8")) as Partial<GithubAccount>;
    if (!raw.accessToken) return null;
    return {
      accessToken: raw.accessToken,
      scopes: raw.scopes ?? [],
      login: raw.login ?? "",
      connectedAt: raw.connectedAt ?? 0,
    };
  } catch {
    return null;
  }
}

export async function saveGithubAccount(account: GithubAccount): Promise<void> {
  const file = githubAccountFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(account, null, 2), { encoding: "utf8", mode: 0o600 });
  // mode is ignored on Windows and when the file already existed.
  await chmod(file, 0o600).catch(() => {});
}

export async function deleteGithubAccount(): Promise<void> {
  await rm(githubAccountFile(), { force: true });
}

export async function requireAccessToken(): Promise<string> {
  const account = await getGithubAccount();
  if (!account) {
    throw new Error("GitHub isn't connected yet — connect it from Settings → Connectors first.");
  }
  return account.accessToken;
}
