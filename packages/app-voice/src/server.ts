/**
 * HTTP server for the realtime voice app — TS port of hf-realtime-voice's
 * server.py, minus the HF OAuth + SQLite usage-metering subsystem (auth.py /
 * limiter.py), which only matters for the deployed HF Space with SPACE_ID
 * set and is deliberately out of scope for this v1 (see the plan). Local and
 * plain-Docker use are unaffected — those already ran unmetered before too.
 *
 * The speech-to-speech backend itself stays a separate, load-balanced
 * service the browser talks to over WebSocket directly (unchanged) — this
 * server only proxies the session handshake (keeps the LB address secret),
 * the web-search key, and bridges to a local Yggdrasil agent for
 * computer_task / computer_approve / remember_fact.
 */

import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { ConnectionError, TimeoutError, type RaceOutcome, type YggdrasilGatewayClient } from "./gateway-client.js";

export type VoiceServerOptions = {
  uiRoot: string;
  loadBalancerUrl: string;
  serperApiKey: string;
  gatewayClient: YggdrasilGatewayClient | null;
};

const MAX_RESULTS = 5;
const MEMORY_LIMIT = 10; // keeps the token cost fixed regardless of how much the user has stored
const SERPER_URL = "https://google.serper.dev/search";
const HEARTBEAT_SEC = 5; // matches limiter.py's default; no metering behind it in v1

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function contentType(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function sendFile(res: ServerResponse, filePath: string): void {
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  createReadStream(filePath).pipe(res);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(resp: Response): Promise<Record<string, unknown>> {
  try {
    const body = (await resp.json()) as unknown;
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, uiRoot: string): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  let rel = url.pathname;
  if (rel === "/") rel = "/index.html";

  const filePath = normalize(join(uiRoot, rel));
  if (!filePath.startsWith(normalize(uiRoot))) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  if (existsSync(filePath)) {
    const info = await stat(filePath);
    if (info.isFile()) {
      sendFile(res, filePath);
      return true;
    }
  }
  return false;
}

function mapGatewayError(res: ServerResponse, err: unknown, timeoutDetail: string): void {
  if (err instanceof ConnectionError) {
    sendJson(res, 503, {
      detail: "The computer-control agent isn't running. Start it locally with `yggdrasil run` and try again.",
    });
  } else if (err instanceof TimeoutError) {
    sendJson(res, 504, { detail: timeoutDetail });
  } else {
    sendJson(res, 502, { detail: `Computer-control agent error: ${err instanceof Error ? err.message : String(err)}` });
  }
}

function sendComputerResponse(res: ServerResponse, outcome: RaceOutcome, sessionKey: string): void {
  if (!outcome.done) {
    const pa = outcome.pendingApproval;
    sendJson(res, 200, {
      pendingApproval: { requestId: pa.requestId, toolName: pa.toolName, args: pa.args, riskLevel: pa.riskLevel },
      sessionKey,
    });
    return;
  }
  const result = (outcome.result ?? {}) as { reply?: string; sessionKey?: string };
  sendJson(res, 200, { output: result.reply ?? "", sessionKey: result.sessionKey ?? sessionKey });
}

export function createVoiceServer(opts: VoiceServerOptions) {
  return createServer(async (req, res) => {
    try {
      await handleRequest(req, res, opts);
    } catch (err) {
      sendJson(res, 500, { detail: err instanceof Error ? err.message : String(err) });
    }
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, opts: VoiceServerOptions): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;
  const method = req.method ?? "GET";

  if (pathname === "/api/config" && method === "GET") {
    sendJson(res, 200, {
      search: !!opts.serperApiKey,
      lb: !!opts.loadBalancerUrl,
      allowDirect: !opts.loadBalancerUrl,
      auth: false, // OAuth/metering deliberately out of scope for this v1
    });
    return;
  }

  if (pathname === "/api/me" && method === "GET") {
    sendJson(res, 200, { enabled: false });
    return;
  }

  if (pathname === "/api/search" && method === "POST") {
    await handleSearch(req, res, opts);
    return;
  }

  if (pathname === "/api/computer" && method === "POST") {
    await handleComputerTask(req, res, opts);
    return;
  }

  if (pathname === "/api/computer/approve" && method === "POST") {
    await handleComputerApprove(req, res, opts);
    return;
  }

  if (pathname === "/api/memories" && method === "GET") {
    await handleMemoriesGet(res, opts);
    return;
  }

  if (pathname === "/api/memories" && method === "POST") {
    await handleMemoriesPost(req, res, opts);
    return;
  }

  if (pathname === "/api/session" && method === "POST") {
    await handleSession(res, opts);
    return;
  }

  // Order matters: the literal "/end" route must be checked before the
  // dynamic "/:queueId" ones below, since both start with "/api/queue/".
  if (pathname === "/api/queue/end" && method === "POST") {
    await handleQueueEnd(req, res, opts);
    return;
  }

  if (pathname.startsWith("/api/queue/") && method === "GET") {
    await handleQueueStatus(res, opts, pathname.slice("/api/queue/".length));
    return;
  }

  if (pathname.startsWith("/api/queue/") && method === "DELETE") {
    await handleQueueLeave(res, opts, pathname.slice("/api/queue/".length));
    return;
  }

  if (pathname === "/api/session/heartbeat" && method === "POST") {
    // No metering in v1 — mirrors today's local (unmetered) behavior exactly.
    sendJson(res, 404, { detail: "Not found." });
    return;
  }

  if (pathname === "/api/session/end" && method === "POST") {
    sendJson(res, 404, { detail: "Not found." });
    return;
  }

  if (await serveStatic(req, res, opts.uiRoot)) return;

  sendJson(res, 404, { detail: "Not found." });
}

async function handleSearch(req: IncomingMessage, res: ServerResponse, opts: VoiceServerOptions): Promise<void> {
  const body = await readJsonBody(req);
  const query = String(body.query ?? "").trim();
  if (!query) {
    sendJson(res, 400, { detail: "Empty query." });
    return;
  }

  const key = String(body.key ?? "").trim() || opts.serperApiKey;
  if (!key) {
    sendJson(res, 503, { detail: "Search is not configured." });
    return;
  }

  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      SERPER_URL,
      {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: MAX_RESULTS }),
      },
      12_000,
    );
  } catch {
    sendJson(res, 502, { detail: "Search provider unreachable." });
    return;
  }

  if (!resp.ok) {
    const body2 = await safeJson(resp);
    const msg = typeof body2.message === "string" ? body2.message : undefined;
    sendJson(res, 502, { detail: `Search provider error (${resp.status})${msg ? `: ${msg}` : ""}` });
    return;
  }

  const data = (await resp.json()) as {
    organic?: Array<{ title?: string; snippet?: string; link?: string }>;
    answerBox?: { answer?: string; snippet?: string };
    knowledgeGraph?: { description?: string };
  };
  const results = (data.organic ?? []).slice(0, MAX_RESULTS).map((item) => ({
    title: item.title ?? "",
    snippet: item.snippet ?? "",
    url: item.link ?? "",
  }));
  const box = data.answerBox ?? {};
  const answer = box.answer ?? box.snippet ?? data.knowledgeGraph?.description ?? null;

  sendJson(res, 200, { query, answer, results });
}

async function handleComputerTask(req: IncomingMessage, res: ServerResponse, opts: VoiceServerOptions): Promise<void> {
  const body = await readJsonBody(req);
  const instruction = String(body.instruction ?? "").trim();
  if (!instruction) {
    sendJson(res, 400, { detail: "Empty instruction." });
    return;
  }
  if (!opts.gatewayClient) {
    sendJson(res, 503, { detail: "Computer control is not configured on this server." });
    return;
  }

  const sessionKey = String(body.sessionKey ?? "") || `voice:${randomUUID()}`;
  const params = { message: instruction, sessionKey, senderId: "app-voice" };

  try {
    const outcome = await opts.gatewayClient.callRacingApproval("chat.send", params, sessionKey, 90_000);
    sendComputerResponse(res, outcome, sessionKey);
  } catch (err) {
    mapGatewayError(res, err, "The computer task is taking too long.");
  }
}

async function handleComputerApprove(req: IncomingMessage, res: ServerResponse, opts: VoiceServerOptions): Promise<void> {
  const body = await readJsonBody(req);
  const requestId = String(body.requestId ?? "");
  const approved = body.approved === true;
  const sessionKey = String(body.sessionKey ?? "");

  if (!opts.gatewayClient) {
    sendJson(res, 503, { detail: "Computer control is not configured on this server." });
    return;
  }

  try {
    await opts.gatewayClient.resolveApproval(requestId, approved, 15_000);
  } catch (err) {
    if (err instanceof ConnectionError) {
      sendJson(res, 503, { detail: "The computer-control agent isn't running." });
    } else {
      sendJson(res, 502, { detail: `Could not resolve approval: ${err instanceof Error ? err.message : String(err)}` });
    }
    return;
  }

  try {
    const outcome = await opts.gatewayClient.awaitPending(sessionKey, 90_000);
    sendComputerResponse(res, outcome, sessionKey);
  } catch (err) {
    if (err instanceof TimeoutError) {
      sendJson(res, 504, { detail: "Approved, but the computer-control agent is taking too long to finish." });
    } else if (err instanceof Error && err.message.startsWith("No pending computer_task call")) {
      sendJson(res, 404, { detail: "No pending computer task found for this conversation." });
    } else {
      sendJson(res, 502, { detail: `Computer-control agent error: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
}

async function handleMemoriesGet(res: ServerResponse, opts: VoiceServerOptions): Promise<void> {
  if (!opts.gatewayClient) {
    sendJson(res, 200, { memories: [] });
    return;
  }
  try {
    const result = (await opts.gatewayClient.call("memory.list", { limit: MEMORY_LIMIT }, 8_000)) as {
      memories?: Array<{ content?: string }>;
    };
    const out = (result.memories ?? [])
      .map((r) => String(r.content ?? "").trim())
      .filter(Boolean)
      .slice(0, MEMORY_LIMIT);
    sendJson(res, 200, { memories: out });
  } catch {
    sendJson(res, 200, { memories: [] });
  }
}

async function handleMemoriesPost(req: IncomingMessage, res: ServerResponse, opts: VoiceServerOptions): Promise<void> {
  const body = await readJsonBody(req);
  const content = String(body.content ?? "").trim();
  if (!content) {
    sendJson(res, 400, { detail: "Empty content." });
    return;
  }
  if (!opts.gatewayClient) {
    sendJson(res, 503, { detail: "Memory is not configured on this server." });
    return;
  }

  try {
    const result = (await opts.gatewayClient.call(
      "memory.add",
      { content, type: body.type || "fact" },
      8_000,
    )) as { memory?: { id?: number } };
    sendJson(res, 200, { ok: true, id: result.memory?.id });
  } catch (err) {
    if (err instanceof ConnectionError) {
      sendJson(res, 503, {
        detail: "Memory storage isn't reachable right now. Start it locally with `yggdrasil run` and try again.",
      });
    } else {
      sendJson(res, 502, { detail: `Could not save that: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
}

/** No metering (auth.py/limiter.py deferred, see module docstring) — every
 * grant looks like today's local/unmetered path: unlimited, no reservation. */
function attachUnmeteredFields(data: Record<string, unknown>): Record<string, unknown> {
  return { ...data, tier: "anon", limited: false, remainingSec: null, heartbeatSec: HEARTBEAT_SEC };
}

async function handleSession(res: ServerResponse, opts: VoiceServerOptions): Promise<void> {
  if (!opts.loadBalancerUrl) {
    sendJson(res, 404, { detail: "Not found." });
    return;
  }
  const url = `${opts.loadBalancerUrl.replace(/\/+$/, "")}/session`;
  let lb: Response;
  try {
    lb = await fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, 15_000);
  } catch {
    sendJson(res, 502, { detail: "Speech service unreachable." });
    return;
  }

  if (lb.status === 503) {
    const body = await safeJson(lb);
    if (body.state === "at_capacity") {
      sendJson(res, 503, { state: "at_capacity" });
      return;
    }
  }
  if (!lb.ok) {
    sendJson(res, 502, { detail: `Session handshake failed (${lb.status}).` });
    return;
  }

  const data = (await lb.json()) as Record<string, unknown>;
  if (data.state === "queued") {
    sendJson(res, 200, { ...data, tier: "anon" });
    return;
  }
  sendJson(res, 200, attachUnmeteredFields(data));
}

async function handleQueueStatus(res: ServerResponse, opts: VoiceServerOptions, queueId: string): Promise<void> {
  if (!opts.loadBalancerUrl) {
    sendJson(res, 404, { detail: "Not found." });
    return;
  }
  const url = `${opts.loadBalancerUrl.replace(/\/+$/, "")}/queue/${queueId}`;
  let lb: Response;
  try {
    lb = await fetchWithTimeout(url, { method: "GET" }, 15_000);
  } catch {
    sendJson(res, 502, { detail: "Speech service unreachable." });
    return;
  }

  if (lb.status === 404) {
    sendJson(res, 404, { state: "expired" });
    return;
  }
  if (!lb.ok) {
    sendJson(res, 502, { detail: `Queue poll failed (${lb.status}).` });
    return;
  }

  const data = (await lb.json()) as Record<string, unknown>;
  if (data.state === "queued") {
    sendJson(res, 200, { ...data, tier: "anon" });
    return;
  }
  sendJson(res, 200, attachUnmeteredFields(data));
}

async function handleQueueLeave(res: ServerResponse, opts: VoiceServerOptions, queueId: string): Promise<void> {
  if (!opts.loadBalancerUrl) {
    sendJson(res, 404, { detail: "Not found." });
    return;
  }
  await lbLeave(opts.loadBalancerUrl, queueId);
  sendJson(res, 200, { ok: true });
}

async function handleQueueEnd(req: IncomingMessage, res: ServerResponse, opts: VoiceServerOptions): Promise<void> {
  if (!opts.loadBalancerUrl) {
    sendJson(res, 404, { detail: "Not found." });
    return;
  }
  const body = await readJsonBody(req);
  const queueId = String(body.queueId ?? "");
  if (queueId) await lbLeave(opts.loadBalancerUrl, queueId);
  sendJson(res, 200, { ok: true });
}

async function lbLeave(loadBalancerUrl: string, queueId: string): Promise<void> {
  const url = `${loadBalancerUrl.replace(/\/+$/, "")}/queue/${queueId}`;
  try {
    await fetchWithTimeout(url, { method: "DELETE" }, 5_000);
  } catch {
    // best-effort — the LB reaps the ticket on TTL anyway
  }
}
