import { getGoogleAccount } from "./account.js";
import { getGoogleOAuthCredentials, refreshAccessToken } from "./oauth.js";

const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GMAIL_MESSAGES_URL = "https://www.googleapis.com/gmail/v1/users/me/messages";

// Exported so drive.ts (a sibling API surface, same auth/error-handling
// needs) can reuse it instead of re-implementing the same fetch+error-body
// wrapping a second time.
export async function googleFetch(url: string, accessToken: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google API ${res.status} for ${url}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return undefined;
  return res.json();
}

// The one function every gcal_*/gmail_* tool calls first — refresh_token
// never expires on its own (only on user revocation), so there's no reason
// to try to reuse a cached access_token across calls when a fresh one is one
// request away and access_tokens are short-lived (~1h) anyway.
export async function getFreshAccessToken(workspaceRoot: string): Promise<string> {
  const account = await getGoogleAccount(workspaceRoot);
  if (!account) {
    throw new Error(
      "Google isn't connected for this gateway yet — call connectors.google.authUrl to start the consent flow.",
    );
  }
  const credentials = getGoogleOAuthCredentials();
  const tokens = await refreshAccessToken(credentials, account.refreshToken);
  return tokens.access_token;
}

export type CalendarEvent = {
  id?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
};

export async function listEvents(
  accessToken: string,
  params: { timeMin?: string; timeMax?: string; maxResults?: number },
): Promise<CalendarEvent[]> {
  const query = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(params.maxResults ?? 20),
  });
  if (params.timeMin) query.set("timeMin", params.timeMin);
  if (params.timeMax) query.set("timeMax", params.timeMax);
  // Calendar API requires timeMin for orderBy:startTime — default to "now"
  // rather than making every caller (including the LLM) remember that.
  if (!params.timeMin) query.set("timeMin", new Date().toISOString());

  const data = (await googleFetch(`${CALENDAR_EVENTS_URL}?${query.toString()}`, accessToken)) as {
    items?: CalendarEvent[];
  };
  return data.items ?? [];
}

export async function createEvent(
  accessToken: string,
  params: { title: string; location?: string; description?: string; startDateTime: string; endDateTime?: string },
): Promise<CalendarEvent> {
  // Google requires an end — same "no duration given" gap phone_add_calendar_event
  // handles by leaving it to the UI; here there's no UI to fall back on, so
  // default to +1h, the same assumption a human leaving the field blank in
  // the Calendar app would get.
  const start = new Date(params.startDateTime);
  const end = params.endDateTime ? new Date(params.endDateTime) : new Date(start.getTime() + 60 * 60_000);

  const body = {
    summary: params.title,
    location: params.location,
    description: params.description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };

  return (await googleFetch(CALENDAR_EVENTS_URL, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as CalendarEvent;
}

export type GmailMessageSummary = { id: string; threadId: string };

export async function searchMessages(
  accessToken: string,
  params: { query: string; maxResults?: number },
): Promise<GmailMessageSummary[]> {
  const query = new URLSearchParams({ q: params.query, maxResults: String(params.maxResults ?? 10) });
  const data = (await googleFetch(`${GMAIL_MESSAGES_URL}?${query.toString()}`, accessToken)) as {
    messages?: GmailMessageSummary[];
  };
  return data.messages ?? [];
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };

function base64UrlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

// Gmail nests the actual body arbitrarily deep under parts (multipart
// messages, nested alternatives) — walk it looking for a text/plain part
// anywhere in the tree first. Two separate passes, not one function that
// falls back per-node: a per-node fallback would let an html part win over
// its own text/plain sibling just because it happens to appear earlier in
// the array (found the hard way — a multipart/alternative with html listed
// before plain returned the html).
function findPlainTextPart(payload: GmailPart | undefined): string | undefined {
  if (!payload) return undefined;
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return base64UrlDecode(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const text = findPlainTextPart(part);
    if (text !== undefined) return text;
  }
  return undefined;
}

// Last resort only — whatever body text exists anywhere, regardless of
// mimeType (covers a message that only ever offers text/html).
function findAnyBodyText(payload: GmailPart | undefined): string | undefined {
  if (!payload) return undefined;
  if (payload.body?.data) return base64UrlDecode(payload.body.data);
  for (const part of payload.parts ?? []) {
    const text = findAnyBodyText(part);
    if (text !== undefined) return text;
  }
  return undefined;
}

function extractPlainText(payload: GmailPart | undefined): string {
  return findPlainTextPart(payload) ?? findAnyBodyText(payload) ?? "";
}

export type GmailMessage = {
  id: string;
  subject?: string;
  from?: string;
  date?: string;
  snippet?: string;
  body: string;
};

export async function getMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
  const data = (await googleFetch(`${GMAIL_MESSAGES_URL}/${encodeURIComponent(messageId)}?format=full`, accessToken)) as {
    id: string;
    snippet?: string;
    payload?: GmailPart & { headers?: Array<{ name: string; value: string }> };
  };

  const headers = (data.payload as { headers?: Array<{ name: string; value: string }> } | undefined)?.headers ?? [];
  const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

  return {
    id: data.id,
    subject: header("Subject"),
    from: header("From"),
    date: header("Date"),
    snippet: data.snippet,
    body: extractPlainText(data.payload),
  };
}
