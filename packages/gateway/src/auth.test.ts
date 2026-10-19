import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, mergeConfig } from "@yggdrasil/config";
import {
  isWsAuthenticatedByDefault,
  tryAuthenticateFromQuery,
  tryAuthenticateFromRequest,
} from "./auth.js";

describe("gateway auth", () => {
  const config = mergeConfig(DEFAULT_CONFIG, {
    auth: { gateway: { apiKey: "dev-secret", required: true } },
  });

  it("requires auth when configured", () => {
    expect(isWsAuthenticatedByDefault(config)).toBe(false);
    expect(tryAuthenticateFromQuery(config, "dev-secret")).toBe(true);
    expect(tryAuthenticateFromQuery(config, "wrong")).toBe(false);
  });

  it("authenticates via auth method", () => {
    expect(
      tryAuthenticateFromRequest(config, {
        method: "auth",
        params: { apiKey: "dev-secret" },
      }),
    ).toBe(true);
    expect(
      tryAuthenticateFromRequest(config, {
        method: "auth",
        params: { apiKey: "bad" },
      }),
    ).toBe(false);
  });

  it("allows open gateway when no key", () => {
    expect(isWsAuthenticatedByDefault(DEFAULT_CONFIG)).toBe(true);
  });
});
