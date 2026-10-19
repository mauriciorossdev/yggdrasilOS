import type { NodeExecutor } from "@yggdrasil/workflows";

// workflows-design.md §4's "http.request" row: "Timeout 30s, tamaño máx. 5 MB" —
// a hard cap on the HTTP call itself, on top of (not instead of) the node's
// own generic timeoutMs/cancellation (executor.ts already combines those
// into the `signal` this executor receives).
const HTTP_TIMEOUT_MS = 30_000;
const HTTP_MAX_BODY_BYTES = 5 * 1024 * 1024;
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

export type HttpRequestOutput = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
};

/** `params.url` (required), `method` (default GET), `headers?`, `body?` (object → JSON, string → raw). Fires "out" — errors (non-2xx isn't one; only a network/timeout/size failure is) surface as a thrown Error, handled by the node's own retry/onError like any other node. */
export const httpRequestExecutor: NodeExecutor = async ({ params, signal }) => {
  const url = String(params.url ?? "");
  if (!url) throw new Error("http.request node requires a `url` param");
  const method = typeof params.method === "string" ? params.method.toUpperCase() : "GET";

  const headers: Record<string, string> = { ...(params.headers as Record<string, string> | undefined) };
  let body: string | undefined;
  if (params.body !== undefined && !BODYLESS_METHODS.has(method)) {
    if (typeof params.body === "string") {
      body = params.body;
    } else {
      body = JSON.stringify(params.body);
      headers["Content-Type"] ??= "application/json";
    }
  }

  const timeoutSignal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeoutSignal]);

  const res = await fetch(url, { method, headers, body, signal: combined });

  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > HTTP_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error(`http.request: response exceeded ${HTTP_MAX_BODY_BYTES} byte cap`);
      }
      chunks.push(value);
    }
  }
  const bodyText = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");

  let parsedBody: unknown = bodyText;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      parsedBody = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
    } catch {
      // Not actually valid JSON despite the content-type — hand back the raw text rather than failing the node.
    }
  }

  const output: HttpRequestOutput = { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers.entries()), body: parsedBody };
  return { handle: "out", output };
};
