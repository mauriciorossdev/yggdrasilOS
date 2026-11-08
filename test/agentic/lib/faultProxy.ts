import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

/**
 * A pass-through proxy in front of an Ollama server that fails some chat requests on purpose, so the retry
 * path (provider-ollama) gets exercised end to end instead of waiting for a real endpoint to have a bad moment.
 *
 * Only POST /api/chat is eligible; everything else (model listing, /api/show) is forwarded untouched. A fault is
 * decided before anything is sent upstream, so a faulted request costs no tokens. The sequence is seeded, so the
 * same seed injects the same faults in the same order.
 */

export type Fault = number | "reset";

export type FaultProxyOptions = {
  /** Where requests go when they are not faulted, e.g. https://ollama.com */
  upstream: string;
  /** Probability (0–1) that an eligible request is faulted. */
  rate: number;
  /** What to inject, cycled in order. Numbers are HTTP statuses; "reset" drops the connection. */
  faults?: Fault[];
  seed?: number;
  /** Never fault more than this many requests in a row, so a high rate cannot starve a turn forever. */
  maxConsecutive?: number;
};

export type FaultProxy = {
  url: string;
  stats: () => { requests: number; chatRequests: number; injected: number };
  close: () => Promise<void>;
};

export const DEFAULT_FAULTS: Fault[] = [500, 503, 429, "reset", 502];

/** Small deterministic PRNG (mulberry32) so a run can be reproduced from its seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "500,503,429,reset" → [500, 503, 429, "reset"]. Unknown entries are rejected. */
export function parseFaults(spec: string | undefined): Fault[] | undefined {
  if (!spec?.trim()) return undefined;
  return spec.split(",").map((part) => {
    const p = part.trim().toLowerCase();
    if (p === "reset") return "reset" as const;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 400 || n > 599) throw new Error(`EVAL_FAULTS: "${part}" is not an HTTP error status (400–599) or "reset"`);
    return n;
  });
}

const HOP_BY_HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "te", "trailer"]);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function forward(req: IncomingMessage, res: ServerResponse, upstream: string): Promise<void> {
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k) && typeof v === "string") headers[k] = v;
  }
  const response = await fetch(`${upstream.replace(/\/$/, "")}${req.url}`, { method: req.method, headers, body });
  const outHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    // fetch has already decoded the body, so its length/encoding headers would no longer match.
    if (!HOP_BY_HOP.has(k) && k !== "content-encoding") outHeaders[k] = v;
  });
  res.writeHead(response.status, outHeaders);
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body as never).pipe(res);
}

export async function startFaultProxy(options: FaultProxyOptions): Promise<FaultProxy> {
  const faults = options.faults?.length ? options.faults : DEFAULT_FAULTS;
  const random = seededRandom(options.seed ?? 1);
  const maxConsecutive = options.maxConsecutive ?? 3;
  let requests = 0;
  let chatRequests = 0;
  let injected = 0;
  let consecutive = 0;
  let nextFault = 0;

  const server: Server = createServer((req, res) => {
    requests++;
    const eligible = req.method === "POST" && req.url === "/api/chat";
    if (eligible) {
      chatRequests++;
      if (consecutive < maxConsecutive && random() < options.rate) {
        const fault = faults[nextFault++ % faults.length]!;
        injected++;
        consecutive++;
        // Drain the request first so the client is not left mid-upload.
        req.resume();
        if (fault === "reset") {
          req.socket.destroy();
          return;
        }
        res.writeHead(fault, { "content-type": "application/json", ...(fault === 429 ? { "retry-after": "1" } : {}) });
        res.end(JSON.stringify({ error: `injected fault (HTTP ${fault})` }));
        return;
      }
      consecutive = 0;
    }
    forward(req, res, options.upstream).catch(() => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "fault proxy could not reach the upstream" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    stats: () => ({ requests, chatRequests, injected }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
