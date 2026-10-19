import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAuthUrl,
  consumePendingState,
  createPendingState,
  exchangeCodeForTokens,
  getGoogleOAuthCredentials,
  refreshAccessToken,
  GOOGLE_OAUTH_SCOPES,
} from "./oauth.js";

const ORIGINAL_ENV = { ...process.env };

describe("getGoogleOAuthCredentials", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws a clear error when GOOGLE_OAUTH_CLIENT_ID/SECRET aren't set — not until actually used", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(() => getGoogleOAuthCredentials()).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });

  it("reads client id/secret from env and defaults the redirect_uri when unset", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id-123";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-456";
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;

    const creds = getGoogleOAuthCredentials();
    expect(creds).toEqual({
      clientId: "id-123",
      clientSecret: "secret-456",
      redirectUri: "yggdrasil://oauth/google/callback",
    });
  });

  it("uses GOOGLE_OAUTH_REDIRECT_URI when set — Frontend's registered custom-scheme value must win", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id-123";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-456";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "yggdrasil://custom/redirect";

    expect(getGoogleOAuthCredentials().redirectUri).toBe("yggdrasil://custom/redirect");
  });
});

describe("buildAuthUrl", () => {
  it("includes client_id/redirect_uri/state/the v1 scope set/access_type=offline/prompt=consent", () => {
    const url = new URL(
      buildAuthUrl({ clientId: "id-123", clientSecret: "x", redirectUri: "yggdrasil://cb" }, "state-abc"),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("id-123");
    expect(url.searchParams.get("redirect_uri")).toBe("yggdrasil://cb");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_OAUTH_SCOPES.join(" "));
  });

  it("v1 scope set has no send/delete-capable Gmail scope, and no full-access Calendar scope", () => {
    expect(GOOGLE_OAUTH_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
  });
});

describe("pending OAuth state (CSRF nonce)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a freshly created state can be consumed exactly once", () => {
    const state = createPendingState();
    expect(consumePendingState(state)).toBe(true);
    expect(consumePendingState(state)).toBe(false);
  });

  it("an unknown state is rejected", () => {
    expect(consumePendingState("never-issued")).toBe(false);
  });

  it("an expired state is rejected even though it was never consumed", () => {
    const state = createPendingState();
    vi.advanceTimersByTime(11 * 60_000);
    expect(consumePendingState(state)).toBe(false);
  });
});

describe("token exchange", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchangeCodeForTokens posts the authorization_code grant with the right fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "a b", token_type: "Bearer" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeCodeForTokens(
      { clientId: "id", clientSecret: "sec", redirectUri: "yggdrasil://cb" },
      "the-code",
    );

    expect(tokens.access_token).toBe("at");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("redirect_uri")).toBe("yggdrasil://cb");
    expect(body.get("client_secret")).toBe("sec");
  });

  it("refreshAccessToken posts the refresh_token grant", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at2", expires_in: 3600, scope: "a b", token_type: "Bearer" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await refreshAccessToken({ clientId: "id", clientSecret: "sec", redirectUri: "yggdrasil://cb" }, "rt-123");

    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-123");
  });

  it("throws with the response body when Google returns a non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":"invalid_grant"}' }),
    );

    await expect(
      exchangeCodeForTokens({ clientId: "id", clientSecret: "sec", redirectUri: "yggdrasil://cb" }, "bad-code"),
    ).rejects.toThrow(/invalid_grant/);
  });
});
