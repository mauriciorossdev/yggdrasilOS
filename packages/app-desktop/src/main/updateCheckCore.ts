// Pure half of the "new version available" notice (updateCheck.ts): parsing the
// releases API response and comparing versions. No Electron imports, so it's
// unit-testable.

export const DEFAULT_RELEASES_URL =
  "https://api.github.com/repos/mauriciorossdev/yggdrasilOS/releases/latest";

/** The only pages the notice's button may open. */
export const RELEASE_PAGE_PREFIX = "https://github.com/mauriciorossdev/yggdrasilOS/releases/";

const TAG_PREFIX = "app-desktop-v";

export interface AvailableUpdate {
  version: string;
  url: string;
}

interface Version {
  core: number[];
  prerelease: boolean;
}

function parseVersion(text: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: Boolean(match[4]) };
}

/**
 * True when `candidate` is newer than `current`. Compares numerically (0.1.10
 * is newer than 0.1.9). A prerelease counts as older than its own release, so
 * 0.2.0 is newer than 0.2.0-beta.1. Unparseable input is never newer.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
  }
  return !a.prerelease && b.prerelease;
}

/**
 * Reads the GitHub `releases/latest` response. Null unless it is a published
 * desktop release (`app-desktop-vX.Y.Z` tag) whose page is on this repo.
 */
export function parseLatestRelease(body: unknown): AvailableUpdate | null {
  if (!body || typeof body !== "object") return null;
  const { tag_name, html_url, draft, prerelease } = body as Record<string, unknown>;
  if (draft === true || prerelease === true) return null;
  if (typeof tag_name !== "string" || !tag_name.startsWith(TAG_PREFIX)) return null;
  if (typeof html_url !== "string" || !html_url.startsWith(RELEASE_PAGE_PREFIX)) return null;
  const version = tag_name.slice(TAG_PREFIX.length);
  if (!parseVersion(version)) return null;
  return { version, url: html_url };
}
