import type { YggdrasilConfig } from "@yggdrasil/config";
import {
  isGatewayAuthRequired,
  resolveAllGatewayApiKeys,
  validateGatewayApiKey,
} from "@yggdrasil/config";
import type { GatewayRequest } from "@yggdrasil/sdk";

export function isWsAuthenticatedByDefault(config: YggdrasilConfig): boolean {
  return !isGatewayAuthRequired(config);
}

export function tryAuthenticateFromQuery(
  config: YggdrasilConfig,
  queryApiKey: string | null,
): boolean {
  if (!isGatewayAuthRequired(config)) return true;
  return validateGatewayApiKey(queryApiKey ?? undefined, config);
}

export function tryAuthenticateFromRequest(
  config: YggdrasilConfig,
  request: GatewayRequest,
): boolean {
  if (request.method !== "auth") return false;
  const params = request.params ?? {};
  const provided = String(params.apiKey ?? "");
  return validateGatewayApiKey(provided, config);
}

/**
 * A connection from another device (LAN, Tailscale, or the phone-link tunnel) must always
 * present a valid key, even when this gateway has none configured — then it can't connect
 * at all until a key exists (notes/features/web-console-upgrade.md, "Seguridad"). Before,
 * a desktop project gateway listening on every interface without a key took writes such as
 * config.patch (API keys) or terminals.write from anyone on the network.
 * YGGDRASIL_ALLOW_UNAUTHENTICATED_REMOTE=1 restores the old behavior on purpose.
 */
export function remoteNeedsKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.YGGDRASIL_ALLOW_UNAUTHENTICATED_REMOTE !== "1";
}

/** A real key match: false when no key is configured (validateGatewayApiKey would say true). */
export function hasValidGatewayKey(config: YggdrasilConfig, provided: string | null | undefined): boolean {
  if (resolveAllGatewayApiKeys(config).length === 0) return false;
  return validateGatewayApiKey(provided ?? undefined, config);
}

/** Why a remote socket was refused, worded for whoever reads it on the other device. */
export function remoteAuthMessage(config: YggdrasilConfig): string {
  return resolveAllGatewayApiKeys(config).length === 0
    ? "This gateway only accepts other devices with an API key, and it has none. " +
        "Pair this device from the desktop app (Settings → Paired devices) or set auth.gateway.apiKey, then connect with that key."
    : "Authentication required. Send { method: 'auth', params: { apiKey } } first.";
}
