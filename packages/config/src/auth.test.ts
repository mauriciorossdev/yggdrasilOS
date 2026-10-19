import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_CONFIG, mergeConfig } from "./index.js";
import {
  isGatewayAuthRequired,
  isHttpAuthRequired,
  parseBearerToken,
  resolveGatewayApiKey,
  resolveHttpApiKey,
  validateApiKey,
} from "./auth.js";

describe("auth", () => {
  const prevEnv = process.env.YGGDRASIL_API_KEY;

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.YGGDRASIL_API_KEY;
    else process.env.YGGDRASIL_API_KEY = prevEnv;
  });

  it("resolveGatewayApiKey prefers config over env", () => {
    process.env.YGGDRASIL_API_KEY = "env-key";
    const config = mergeConfig(DEFAULT_CONFIG, {
      auth: { gateway: { apiKey: "config-key" } },
    });
    expect(resolveGatewayApiKey(config)).toBe("config-key");
  });

  it("resolveGatewayApiKey falls back to env", () => {
    process.env.YGGDRASIL_API_KEY = "env-key";
    expect(resolveGatewayApiKey(DEFAULT_CONFIG)).toBe("env-key");
  });

  it("resolveHttpApiKey uses legacy account token", () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      channels: { http: { accounts: { default: { token: "legacy-token" } } } },
    });
    expect(resolveHttpApiKey(config)).toBe("legacy-token");
  });

  it("isGatewayAuthRequired when apiKey configured", () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      auth: { gateway: { apiKey: "secret" } },
    });
    expect(isGatewayAuthRequired(config)).toBe(true);
  });

  it("validateApiKey and parseBearerToken", () => {
    expect(validateApiKey("abc", "abc")).toBe(true);
    expect(validateApiKey("wrong", "abc")).toBe(false);
    expect(parseBearerToken("Bearer tok")).toBe("tok");
    expect(isHttpAuthRequired(mergeConfig(DEFAULT_CONFIG, {
      auth: { http: { apiKey: "x" } },
    }))).toBe(true);
  });
});
