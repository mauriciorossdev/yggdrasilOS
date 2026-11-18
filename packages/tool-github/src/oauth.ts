// OAuth Device Flow (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
// — fits a desktop app: no redirect URI, no client secret. The client_id of
// a GitHub OAuth App is public, so it's fine to ship in source (see below).

// `repo` = read private repos + clone them over HTTPS. Narrower than that
// isn't possible for private repos with an OAuth App.
export const GITHUB_OAUTH_SCOPES = ["repo"];

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * Client ID of Yggdrasil's own GitHub OAuth App (Device Flow enabled). It's
 * public by design — Device Flow has no client secret, and each user still
 * authorizes on github.com with their own account; the app's owner never sees
 * their tokens. Shipping it means the connector works out of the box in dev,
 * in released builds and in the open-source repo. Forks/self-builders can use
 * their own OAuth App by setting GITHUB_OAUTH_CLIENT_ID.
 */
export const DEFAULT_GITHUB_OAUTH_CLIENT_ID = "Ov23lirzgPyFGfN0tRXt";

export function getGithubClientId(): string {
  return process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || DEFAULT_GITHUB_OAUTH_CLIENT_ID;
}

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${url} returned ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  return postForm<DeviceCodeResponse>(DEVICE_CODE_URL, { client_id: clientId, scope: GITHUB_OAUTH_SCOPES.join(" ") });
}

export type PollResult =
  | { status: "authorized"; accessToken: string; scopes: string[] }
  | { status: "pending"; interval?: number }
  | { status: "error"; error: string };

export async function pollForToken(clientId: string, deviceCode: string): Promise<PollResult> {
  const data = await postForm<{
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
    interval?: number;
  }>(TOKEN_URL, {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  if (data.access_token) {
    return { status: "authorized", accessToken: data.access_token, scopes: (data.scope ?? "").split(",").filter(Boolean) };
  }
  if (data.error === "authorization_pending") return { status: "pending" };
  if (data.error === "slow_down") return { status: "pending", interval: data.interval };
  return { status: "error", error: data.error_description ?? data.error ?? "unknown error" };
}
