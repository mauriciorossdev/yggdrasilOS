/**
 * Browsers attach an Origin header to every WebSocket handshake, and any website open in
 * the user's browser can try `new WebSocket("ws://127.0.0.1:<port>")`. Such a page is
 * "foreign": it must not inherit this machine's implicit trust (no key needed on loopback,
 * YGGDRASIL_TRUST_LOOPBACK). It can still connect with a real key, so the web console
 * opened from the phone/LAN/Tailscale keeps working once paired.
 *
 * Not foreign:
 * - no Origin header: Node/Dart clients (TUI, desktop main, tunnel relay, phone app);
 * - an Origin whose hostname is loopback (desktop dev renderer, the console at
 *   http://127.0.0.1:<port>/ui, local dev servers). Matched by hostname, not against the
 *   Host header, which a DNS-rebinding page controls;
 * - file:// (the packaged Electron renderers load from disk; no website can send it);
 * - anything listed in YGGDRASIL_ALLOWED_ORIGINS (comma-separated, exact origins, or "*").
 *
 * "null" (sandboxed iframes, which any page can create) is foreign.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.YGGDRASIL_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, "").toLowerCase())
    .filter(Boolean);
}

export function isForeignOrigin(origin: string | string[] | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const value = Array.isArray(origin) ? origin[0] : origin;
  if (value === undefined || value === "") return false;
  const allowed = allowedOrigins(env);
  if (allowed.includes("*")) return false;
  const normalized = value.trim().replace(/\/+$/, "").toLowerCase();
  if (allowed.includes(normalized)) return false;
  if (normalized === "file:" || normalized === "file://") return false;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return true;
  }
  if (url.protocol === "file:") return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  return !LOOPBACK_HOSTS.has(url.hostname);
}
