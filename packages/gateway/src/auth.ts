import type { YggdrasilConfig } from "@yggdrasil/config";
import {
  isGatewayAuthRequired,
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
