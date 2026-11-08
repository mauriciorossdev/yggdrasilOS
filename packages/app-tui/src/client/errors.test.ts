import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors.js";
import { GatewayAuthError } from "./gateway-client.js";

describe("friendlyError", () => {
  it("points an unauthorized gateway at the API key", () => {
    expect(friendlyError(new Error("UNAUTHORIZED: Authentication required."))).toMatch(/YGGDRASIL_API_KEY/);
  });
  it("keeps the auth error's own message", () => {
    expect(friendlyError(new GatewayAuthError("The gateway rejected the API key"))).toBe("The gateway rejected the API key");
  });
  it("passes other errors through", () => {
    expect(friendlyError(new Error("boom"))).toBe("boom");
    expect(friendlyError("plain")).toBe("plain");
  });
});
