import type { YggdrasilConfig } from "./index.js";

export type ApiKeyEntry = {
  key: string;
  name: string;
  expiresAt?: number; // unix timestamp ms
};

export type AuthConfig = {
  gateway?: {
    apiKey?: string;         // legacy single key
    apiKeys?: ApiKeyEntry[]; // multi-key with metadata
    required?: boolean;
  };
  http?: {
    apiKey?: string;
  };
};

function envApiKey(): string | undefined {
  return process.env.YGGDRASIL_API_KEY?.trim() || undefined;
}

export function resolveGatewayApiKey(config: YggdrasilConfig): string | undefined {
  const fromConfig = config.auth?.gateway?.apiKey?.trim();
  if (fromConfig) return fromConfig;
  return envApiKey();
}

export function resolveAllGatewayApiKeys(config: YggdrasilConfig): ApiKeyEntry[] {
  const keys: ApiKeyEntry[] = [];

  // legacy single key
  const single = resolveGatewayApiKey(config);
  if (single) keys.push({ key: single, name: "default" });

  // multi-key list
  const multi = config.auth?.gateway?.apiKeys ?? [];
  for (const entry of multi) {
    if (entry.key?.trim() && !keys.some((k) => k.key === entry.key)) {
      keys.push(entry);
    }
  }

  return keys;
}

export function resolveHttpApiKey(config: YggdrasilConfig, accountId = "default"): string | undefined {
  const fromHttp = config.auth?.http?.apiKey?.trim();
  if (fromHttp) return fromHttp;

  const shared = envApiKey() ?? resolveGatewayApiKey(config);
  if (shared) return shared;

  const accountCfg = config.channels?.http?.accounts?.[accountId] as { token?: string } | undefined;
  return accountCfg?.token?.trim() || undefined;
}

export function isGatewayAuthRequired(config: YggdrasilConfig): boolean {
  if (config.auth?.gateway?.required === true) return true;
  if (config.auth?.gateway?.required === false) return false;
  return resolveAllGatewayApiKeys(config).length > 0;
}

export function isHttpAuthRequired(config: YggdrasilConfig, accountId = "default"): boolean {
  return Boolean(resolveHttpApiKey(config, accountId));
}

export function validateApiKey(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected) return true;
  return (provided ?? "").trim() === expected.trim();
}

export function validateGatewayApiKey(provided: string | undefined, config: YggdrasilConfig): boolean {
  const keys = resolveAllGatewayApiKeys(config);
  if (keys.length === 0) return true;
  const now = Date.now();
  const trimmed = (provided ?? "").trim();
  return keys.some((k) => k.key === trimmed && (!k.expiresAt || k.expiresAt > now));
}

export function parseBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice("Bearer ".length).trim() || undefined;
}
