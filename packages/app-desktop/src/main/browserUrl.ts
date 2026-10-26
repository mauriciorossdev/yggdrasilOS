// Pure URL handling for the Browser tab, split out of browserTabView.ts so it
// can be unit-tested without Electron.

// Schemes the picker/address-bar (and browser_open, agent-callable) may
// navigate to. Rejects `file://`/`javascript:`/`data:` etc. — this view
// loads arbitrary agent- or user-supplied URLs into a real, unsandboxed-
// from-the-page's-perspective web page; letting it navigate to a local
// file URL would hand a malicious/compromised page read access to the
// filesystem path space, and javascript:/data: are classic XSS-adjacent
// injection vectors with no legitimate "browse to a website" use case here.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const SEARCH_URL = "https://duckduckgo.com/?q=";

export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("browser: url is required");
  // A bare "example.com" (no scheme) is the common case from an address
  // bar or an agent — default to https, same as every modern browser's own
  // omnibox does for a schemeless input that looks like a host.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`browser: unsupported URL scheme "${parsed.protocol}" — only http/https are allowed`);
  }
  return parsed.toString();
}

// `localhost`, an IPv4 address, an IPv6 literal, a dotted name (example.com,
// docs.foo.dev/path), or any bare host with an explicit port — optionally
// followed by a path/query/fragment. No whitespace anywhere.
const LOOKS_LIKE_HOST =
  /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[^\s/?#:]+\.[^\s/?#:.]{2,}|[^\s/?#:]+(?=:\d))(?::\d+)?(?:[/?#]\S*)?$/i;
// A scheme prefix that is really `host:port` (localhost:3000), not `scheme:`.
const HOST_PORT_PREFIX = /^[^\s/:]+:\d+(?:[/?#]|$)/;
// Dev servers and LAN hosts rarely have TLS — default those to http.
const LOCAL_HOST = /^(?:localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.)/i;

/**
 * What the address bar does with whatever the user typed: a URL (or something
 * that looks like a host) navigates, anything else becomes a web search. Always
 * resolves to http(s) — an explicit non-http scheme (`javascript:`, `file:`)
 * throws via normalizeBrowserUrl instead of being searched for.
 */
export function resolveBrowserInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("browser: url is required");

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !HOST_PORT_PREFIX.test(trimmed);
  if (hasScheme) return normalizeBrowserUrl(trimmed);

  if (LOOKS_LIKE_HOST.test(trimmed)) {
    // Explicit scheme always: normalizeBrowserUrl would read `myhost:8080`'s
    // "myhost:" as a scheme and reject it.
    return normalizeBrowserUrl(`${LOCAL_HOST.test(trimmed) ? "http" : "https"}://${trimmed}`);
  }
  return `${SEARCH_URL}${encodeURIComponent(trimmed)}`;
}
