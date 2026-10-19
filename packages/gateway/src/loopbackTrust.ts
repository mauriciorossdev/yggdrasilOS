/** The three forms Node reports for a loopback peer (plain v4, v6, and v4-mapped v6). */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/**
 * Opt-in (YGGDRASIL_TRUST_LOOPBACK=1): connections from this same machine skip
 * the API-key handshake while everyone else (LAN, Tailscale) must send the key.
 * The desktop app sets it when it gives its per-project gateways a key, so its
 * own window keeps connecting without knowing that key.
 */
export function isTrustedLoopback(remoteAddress: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.YGGDRASIL_TRUST_LOOPBACK === "1" && isLoopbackAddress(remoteAddress);
}
