// OAuth Device Flow (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
// — fits a desktop app: no redirect URI, no client secret. The client_id of
// a GitHub OAuth App is public, so it's fine to ship/configure in plain env.

// `repo` = read private repos + clone them over HTTPS. Narrower than that
// isn't possible for private repos with an OAuth App.
export const GITHUB_OAUTH_SCOPES = ["repo"];

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

export function getGithubClientId(): string {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error(
      "connectors.github: GITHUB_OAUTH_CLIENT_ID must be set in the environment (a GitHub OAuth App with " +
        '"Enable Device Flow" checked) — not configured yet.',
    );
  }
  return clientId;
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
