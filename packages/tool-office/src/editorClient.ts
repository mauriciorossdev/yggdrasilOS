/**
 * Calls an operation on an in-app editor through THIS project's pane-control server (app-desktop's
 * main/paneControlServer.ts → POST /editors/call), the same loopback bridge tool-desktop uses: the editors
 * live in the Electron renderer, not in this gateway subprocess, and the URL + token come in through env
 * at spawn time. Outside the desktop app every call reports that, in words the model can pass on.
 */

export class EditorUnavailableError extends Error {
  constructor() {
    super("The in-app editors are not reachable — spreadsheet tools only work inside Yggdrasil Desktop.");
    this.name = "EditorUnavailableError";
  }
}

function endpoint(): { url: string; token: string } | undefined {
  const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
  const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
  return url && token ? { url, token } : undefined;
}

export async function callEditor<T>(kind: string, op: string, params: Record<string, unknown>): Promise<T> {
  const target = endpoint();
  if (!target) throw new EditorUnavailableError();
  const res = await fetch(`${target.url}/editors/call`, {
    method: "POST",
    headers: { authorization: `Bearer ${target.token}`, "content-type": "application/json" },
    body: JSON.stringify({ kind, op, params }),
  });
  const json = (await res.json().catch(() => ({}))) as { result?: T; message?: string; error?: string };
  if (!res.ok) throw new Error(json.message ?? json.error ?? `editor request failed (${res.status})`);
  return json.result as T;
}
