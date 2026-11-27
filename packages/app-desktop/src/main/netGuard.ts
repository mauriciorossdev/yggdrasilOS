// Pure address/URL checks behind ygg.net.fetch (widgetNet.ts). A widget may
// only reach public hosts it was granted, over HTTPS.
import { isIP } from "node:net";

function ipv4Public(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/**
 * True only for globally routable unicast addresses. IPv6 is an allow-list
 * (2000::/3), so loopback, ULA, link-local, multicast and every IPv4-mapped or
 * NAT64 form are refused without having to decode them.
 */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Public(ip);
  if (kind !== 6) return false;
  const groups = ip.toLowerCase().split("%")[0].split(":");
  const first = parseInt(groups[0] || "0", 16);
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2002) return false; // 6to4 embeds an arbitrary IPv4
  if (first === 0x2001 && parseInt(groups[1] || "0", 16) < 0x200) return false; // Teredo and other special-use
  return true;
}

/** Why a widget's URL can't be fetched. Carried to the widget as the error's code. */
export type NetErrorCode = "bad-url" | "not-granted" | "no-secret" | "blocked-address" | "too-large" | "timeout" | "network";

export class NetError extends Error {
  constructor(
    readonly code: NetErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

/** HTTPS, default port, no credentials, and a host in `allowed`. */
export function checkUrl(raw: string, allowed: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NetError("bad-url", "URL inválida");
  }
  if (url.protocol !== "https:") throw new NetError("bad-url", "solo HTTPS");
  if (url.username || url.password) throw new NetError("bad-url", "la URL no puede llevar credenciales");
  if (url.port) throw new NetError("bad-url", "solo el puerto 443");
  if (!allowed.includes(url.hostname)) throw new NetError("not-granted", `sin permiso para ${url.hostname}`);
  return url;
}
