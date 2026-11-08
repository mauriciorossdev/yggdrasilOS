import { GatewayAuthError } from "./gateway-client.js";

/** Turns a gateway/client error into something the user can act on. */
export function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof GatewayAuthError) return message;
  if (message.startsWith("UNAUTHORIZED") || /authentication required/i.test(message)) {
    return "The gateway requires an API key. Set YGGDRASIL_API_KEY or pass --api-key.";
  }
  return message;
}
