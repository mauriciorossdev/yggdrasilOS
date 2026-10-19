import { randomUUID } from "node:crypto";

// v1 scope set (external-actions-and-connectors-analysis.md §1.4 "v1
// propuesto"): calendar.events covers both listing and creating events
// (read+write on the events resource, nothing broader); gmail.readonly
// covers search+read with no send/delete grant at all — enforced at the
// OAuth consent level, not just by which tools happen to be implemented.
// drive.file (added for notes→Drive sharing) is deliberately the narrowest
// Drive scope: it only grants access to files/folders this app itself
// creates, never the user's whole Drive. Any account that connected before
// this scope was added needs to reconnect once — a stored refresh_token
// doesn't retroactively gain new scopes.
export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// Phone-initiated consent (external-actions-and-connectors-analysis.md
// §1.3-b, the recommended flow): the redirect_uri is a custom scheme the
// mobile app registers an intent-filter for and intercepts locally — no
// loopback HTTP server anywhere, on the gateway or the phone. This exact
// string has to match what's registered in the Google Cloud Console OAuth
// client AND the Android intent-filter, so it's independently overridable
// here without a code change once that's finalized with Frontend.
const DEFAULT_REDIRECT_URI = "yggdrasil://oauth/google/callback";

// State tokens expire quickly — this is a CSRF nonce for a single consent
// round trip a human completes in their browser within a minute or two, not
// a credential that needs a long window like a device-tool approval.
const STATE_TTL_MS = 10 * 60_000;

export type GoogleOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

// Read lazily (not at module load / plugin register time) so a gateway with
// no Google OAuth app configured yet still starts up fine — this only
// throws when someone actually tries to use the connector, with a message
// that says exactly what to set.
export function getGoogleOAuthCredentials(): GoogleOAuthCredentials {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "connectors.google: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in the gateway's " +
        "environment (a Google Cloud Console OAuth 2.0 Client ID of type \"Web application\") — not configured yet.",
    );
  }
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
  return { clientId, clientSecret, redirectUri };
}

const pendingStates = new Map<string, number>();

function pruneExpiredStates(): void {
  const now = Date.now();
  for (const [state, expiresAt] of pendingStates) {
    if (expiresAt <= now) pendingStates.delete(state);
  }
}

export function createPendingState(): string {
  pruneExpiredStates();
  const state = randomUUID();
  pendingStates.set(state, Date.now() + STATE_TTL_MS);
  return state;
}

// One-shot: a state is consumed (and rejected on replay) the moment it's
// checked, same "no reuse" property a CSRF nonce needs.
export function consumePendingState(state: string): boolean {
  pruneExpiredStates();
  return pendingStates.delete(state);
}

export function buildAuthUrl(credentials: GoogleOAuthCredentials, state: string): string {
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: credentials.redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    // Forces Google to hand back a refresh_token even on a re-consent by an
    // account that already granted access before — without this, a second
    // authorization for the same account can silently omit refresh_token.
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token endpoint returned ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as TokenResponse;
}

export function exchangeCodeForTokens(
  credentials: GoogleOAuthCredentials,
  code: string,
): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: credentials.redirectUri,
      grant_type: "authorization_code",
    }),
  );
}

// Refresh responses don't reliably re-include refresh_token — callers must
// keep using the one they already have on disk, this only ever returns a
// fresh access_token.
export function refreshAccessToken(
  credentials: GoogleOAuthCredentials,
  refreshToken: string,
): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  );
}
