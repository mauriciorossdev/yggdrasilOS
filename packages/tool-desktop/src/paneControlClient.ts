/**
 * Bridges into THIS project's pane-control server (app-desktop's
 * main/paneControlServer.ts), same pattern as packages/gateway/src/methods.ts's
 * terminals.* methods — it lives in Electron's main process, not this gateway
 * subprocess, and its URL+token are handed across via env at spawn time (see
 * app-desktop's main/gateway.ts). Unavailable outside the desktop app (e.g. a
 * headless `yggdrasil run`), in which case every tool here reports
 * `available: false` instead of throwing — the model can read that and tell
 * the user why, same shape as terminals.list's own `available` field.
 */

export class DesktopControlUnavailableError extends Error {
  constructor() {
    super("Desktop control server is not reachable — this tool only works inside Yggdrasil Desktop.");
    this.name = "DesktopControlUnavailableError";
  }
}

/** Thrown for a route's own reported error (e.g. `permission_required`) — distinct from connectivity failures above. */
export class DesktopControlError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "DesktopControlError";
  }
}

function paneControlEndpoint(): { url: string; token: string } | undefined {
  const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
  const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
  if (!url || !token) return undefined;
  return { url, token };
}

export async function callDesktopControl<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const endpoint = paneControlEndpoint();
  if (!endpoint) throw new DesktopControlUnavailableError();

  const res = await fetch(`${endpoint.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : `http_${res.status}`;
    throw new DesktopControlError(code, typeof json.message === "string" ? json.message : undefined);
  }
  return json as T;
}
