import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mock } from "vitest";

vi.mock("@yggdrasil/kernel", () => ({
  getKernelContext: vi.fn(),
}));

import { getKernelContext } from "@yggdrasil/kernel";
import { writeConfigFile, readConfigFile } from "@yggdrasil/config";
import { getGoogleAccount, getWorkspaceRootOrThrow, saveGoogleAccount } from "./account.js";
import type { TokenResponse } from "./oauth.js";

describe("getWorkspaceRootOrThrow", () => {
  it("throws when the kernel has no workspaceRoot (or isn't running)", () => {
    (getKernelContext as unknown as Mock).mockReturnValue(null);
    expect(() => getWorkspaceRootOrThrow("some_tool")).toThrow(/no workspaceRoot/);
  });

  it("returns the kernel's workspaceRoot", () => {
    (getKernelContext as unknown as Mock).mockReturnValue({ workspaceRoot: "/tmp/proj", config: {}, state: "running" });
    expect(getWorkspaceRootOrThrow("some_tool")).toBe("/tmp/proj");
  });
});

describe("saveGoogleAccount / getGoogleAccount", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-google-"));
  });

  it("has no account before anything is saved", async () => {
    expect(await getGoogleAccount(workspaceRoot)).toBeNull();
  });

  it("rejects a token response with no refresh_token, with an actionable message", async () => {
    const tokens: TokenResponse = { access_token: "at", expires_in: 3600, scope: "a", token_type: "Bearer" };
    await expect(saveGoogleAccount(workspaceRoot, tokens)).rejects.toThrow(/didn't return a refresh_token/);
  });

  it("persists refreshToken/scopes/connectedAt and reads them back", async () => {
    const tokens: TokenResponse = {
      access_token: "at",
      refresh_token: "1//real-refresh",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.readonly",
      token_type: "Bearer",
    };
    await saveGoogleAccount(workspaceRoot, tokens);

    const account = await getGoogleAccount(workspaceRoot);
    expect(account?.refreshToken).toBe("1//real-refresh");
    expect(account?.scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    expect(account?.connectedAt).toBeGreaterThan(0);
  });

  it("doesn't wipe an unrelated pre-existing connector or channel when saving", async () => {
    await writeConfigFile(workspaceRoot, {
      connectors: { notion: { enabled: true, accounts: { default: { apiKey: "notion-key" } } } },
      channels: { http: { enabled: true } },
    });

    await saveGoogleAccount(workspaceRoot, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: "a",
      token_type: "Bearer",
    });

    const { config } = await readConfigFile(workspaceRoot);
    expect((config.connectors?.notion?.accounts as { default: { apiKey: string } })?.default?.apiKey).toBe(
      "notion-key",
    );
    expect(config.channels?.http?.enabled).toBe(true);
    expect((config.connectors?.google?.accounts as { default: { refreshToken: string } })?.default?.refreshToken).toBe(
      "rt",
    );
  });

  it("re-saving (reconnecting) overwrites the previous account rather than accumulating", async () => {
    await saveGoogleAccount(workspaceRoot, {
      access_token: "at1",
      refresh_token: "rt1",
      expires_in: 3600,
      scope: "a",
      token_type: "Bearer",
    });
    await saveGoogleAccount(workspaceRoot, {
      access_token: "at2",
      refresh_token: "rt2",
      expires_in: 3600,
      scope: "b",
      token_type: "Bearer",
    });

    const account = await getGoogleAccount(workspaceRoot);
    expect(account?.refreshToken).toBe("rt2");
    expect(account?.scopes).toEqual(["b"]);
  });
});
