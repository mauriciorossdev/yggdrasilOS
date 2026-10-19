import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mock } from "vitest";

vi.mock("@yggdrasil/kernel", () => ({
  getKernelContext: vi.fn(),
}));

import { getKernelContext } from "@yggdrasil/kernel";
import { saveGoogleAccount } from "./account.js";
import { gcalCreateEventTool, gcalListEventsTool, gmailReadTool, gmailSearchTool } from "./tools.js";

const CTX = { sessionKey: "s", config: {} };

describe("connector tools — not-connected error path", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-google-tools-"));
    (getKernelContext as unknown as Mock).mockReturnValue({ workspaceRoot, config: {}, state: "running" });
  });

  it("gcal_list_events errors with instructions to connect first, not a raw fetch error", async () => {
    await expect(gcalListEventsTool.execute(CTX, {})).rejects.toThrow(/connectors.google.authUrl/);
  });

  it("gmail_search errors the same way when not connected", async () => {
    await expect(gmailSearchTool.execute(CTX, { query: "x" })).rejects.toThrow(/connectors.google.authUrl/);
  });
});

describe("connector tools — input validation before any network call", () => {
  it("gcal_create_event rejects a missing title", async () => {
    await expect(gcalCreateEventTool.execute(CTX, { startDateTime: "2026-09-06T15:00:00Z" })).rejects.toThrow(
      /title is required/,
    );
  });

  it("gcal_create_event rejects a missing startDateTime", async () => {
    await expect(gcalCreateEventTool.execute(CTX, { title: "x" })).rejects.toThrow(/startDateTime is required/);
  });

  it("gmail_search rejects a missing query", async () => {
    await expect(gmailSearchTool.execute(CTX, {})).rejects.toThrow(/query is required/);
  });

  it("gmail_read rejects a missing messageId", async () => {
    await expect(gmailReadTool.execute(CTX, {})).rejects.toThrow(/messageId is required/);
  });
});

describe("connector tools — happy path once connected", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-google-tools-connected-"));
    (getKernelContext as unknown as Mock).mockReturnValue({ workspaceRoot, config: {}, state: "running" });
    await saveGoogleAccount(workspaceRoot, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: "a",
      token_type: "Bearer",
    });
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "sec";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gcal_create_event refreshes the token then creates the event, returning a narrow result shape", async () => {
    const fetchMock = vi
      .fn()
      // 1st call: refresh_token grant
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "fresh-at", expires_in: 3600, scope: "a", token_type: "Bearer" }),
      })
      // 2nd call: calendar create
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ summary: "Dentist", htmlLink: "https://calendar.google.com/z" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await gcalCreateEventTool.execute(CTX, {
      title: "Dentist",
      startDateTime: "2026-09-06T15:00:00Z",
    });

    expect(result).toEqual({ created: true, title: "Dentist", link: "https://calendar.google.com/z" });
    // Confirms the refresh happens before the actual API call, and the
    // resulting fresh token is what's used to authorize it.
    const [, createInit] = fetchMock.mock.calls[1];
    expect(createInit.headers.Authorization).toBe("Bearer fresh-at");
  });
});
