import { describe, it, expect, vi, afterEach } from "vitest";
import { createEvent, getMessage, listEvents, searchMessages } from "./google-api.js";

function mockFetchOnce(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listEvents", () => {
  it("sends the Bearer token and maps items to a flatter shape", async () => {
    const fetchMock = mockFetchOnce({
      items: [
        {
          summary: "Standup",
          location: "Zoom",
          start: { dateTime: "2026-09-06T09:00:00Z" },
          end: { dateTime: "2026-09-06T09:15:00Z" },
          htmlLink: "https://calendar.google.com/x",
        },
      ],
    });

    // listEvents itself returns the raw CalendarEvent shape — the
    // title/start/end/link flattening happens one layer up, in
    // gcalListEventsTool.execute (tools.ts).
    const events = await listEvents("access-tok", {});
    expect(events).toEqual([
      {
        summary: "Standup",
        location: "Zoom",
        start: { dateTime: "2026-09-06T09:00:00Z" },
        end: { dateTime: "2026-09-06T09:15:00Z" },
        htmlLink: "https://calendar.google.com/x",
      },
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer access-tok");
    expect(String(url)).toContain("calendar/v3/calendars/primary/events");
    expect(String(url)).toContain("orderBy=startTime");
  });

  it("defaults timeMin to now when not given, so orderBy:startTime doesn't reject the request", async () => {
    const fetchMock = mockFetchOnce({ items: [] });
    await listEvents("tok", {});
    const [url] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).searchParams.get("timeMin")).toBeTruthy();
  });

  it("returns an empty array when the calendar has no items key at all", async () => {
    mockFetchOnce({});
    expect(await listEvents("tok", {})).toEqual([]);
  });
});

describe("createEvent", () => {
  it("POSTs summary/location/description/start/end, defaulting end to +1h when omitted", async () => {
    const fetchMock = mockFetchOnce({ summary: "Dentist", htmlLink: "https://calendar.google.com/y" });

    const result = await createEvent("tok", { title: "Dentist", startDateTime: "2026-09-06T15:00:00Z" });
    expect(result.summary).toBe("Dentist");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.summary).toBe("Dentist");
    expect(new Date(body.end.dateTime).getTime() - new Date(body.start.dateTime).getTime()).toBe(60 * 60_000);
  });

  it("uses the explicit endDateTime when given, not the +1h default", async () => {
    const fetchMock = mockFetchOnce({});
    await createEvent("tok", {
      title: "Long meeting",
      startDateTime: "2026-09-06T15:00:00Z",
      endDateTime: "2026-09-06T17:00:00Z",
    });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(new Date(body.end.dateTime).getTime() - new Date(body.start.dateTime).getTime()).toBe(2 * 60 * 60_000);
  });
});

describe("searchMessages", () => {
  it("sends the query as q= and returns the raw message id/threadId list", async () => {
    const fetchMock = mockFetchOnce({ messages: [{ id: "m1", threadId: "t1" }] });
    const results = await searchMessages("tok", { query: "from:boss" });
    expect(results).toEqual([{ id: "m1", threadId: "t1" }]);
    const [url] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).searchParams.get("q")).toBe("from:boss");
  });

  it("returns an empty array when there are no matches", async () => {
    mockFetchOnce({});
    expect(await searchMessages("tok", { query: "nothing matches this" })).toEqual([]);
  });
});

describe("getMessage", () => {
  function b64url(text: string): string {
    return Buffer.from(text, "utf8").toString("base64url");
  }

  it("extracts headers and a top-level text/plain body", async () => {
    mockFetchOnce({
      id: "m1",
      snippet: "Hi there...",
      payload: {
        headers: [
          { name: "Subject", value: "Hello" },
          { name: "From", value: "a@b.com" },
          { name: "Date", value: "Sun, 06 Sep 2026 10:00:00 +0000" },
        ],
        mimeType: "text/plain",
        body: { data: b64url("Hi there, full body.") },
      },
    });

    const msg = await getMessage("tok", "m1");
    expect(msg.subject).toBe("Hello");
    expect(msg.from).toBe("a@b.com");
    expect(msg.body).toBe("Hi there, full body.");
  });

  it("walks nested multipart parts to find the text/plain part", async () => {
    mockFetchOnce({
      id: "m2",
      payload: {
        headers: [],
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/html", body: { data: b64url("<p>html</p>") } },
              { mimeType: "text/plain", body: { data: b64url("plain text wins") } },
            ],
          },
        ],
      },
    });

    const msg = await getMessage("tok", "m2");
    expect(msg.body).toBe("plain text wins");
  });

  it("falls back to whatever body text exists only when no text/plain part exists anywhere in the tree", async () => {
    mockFetchOnce({
      id: "m3",
      payload: {
        headers: [],
        mimeType: "multipart/alternative",
        parts: [{ mimeType: "text/html", body: { data: b64url("<p>html only</p>") } }],
      },
    });

    const msg = await getMessage("tok", "m3");
    expect(msg.body).toBe("<p>html only</p>");
  });
});

describe("error handling", () => {
  it("throws with the response status and body when Google returns a non-ok response", async () => {
    mockFetchOnce({ error: "insufficient_scope" }, false, 403);
    await expect(listEvents("tok", {})).rejects.toThrow(/403/);
  });
});
