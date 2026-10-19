// Smoke test for the POST|GET /hooks/workflows/:id HTTP route
// (workflows-design.md §7.3) — a real HTTP server, real fetch(), and a fake
// "workflows.runWebhook" method registered directly via @yggdrasil/kernel
// (same trick config-methods.test.ts / device-tools.test.ts use), so this
// stays a gateway-package test with no dependency on
// extensions/service-workflows: it only proves the HTTP-to-RPC bridge in
// server.ts itself — path matching, auth header/signature extraction, body
// reading, rate limiting, and status-code mapping — not the plugin's own
// business logic (covered by that package's own tests).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Mock } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn() };
});

import { homedir } from "node:os";
import { DEFAULT_CONFIG, mergeConfig } from "@yggdrasil/config";
import { registerGatewayMethod, resetRegistryForTest } from "@yggdrasil/kernel";
import type { GatewayHandler } from "@yggdrasil/sdk";
import { startGatewayServer, type GatewayServer } from "./server.js";

describe("POST|GET /hooks/workflows/:id", () => {
  let gateway: GatewayServer;
  let baseUrl: string;
  let received: Parameters<GatewayHandler>[0] | undefined;

  beforeEach(async () => {
    resetRegistryForTest();
    received = undefined;

    const home = await mkdtemp(join(tmpdir(), "ygg-home-webhook-"));
    (homedir as unknown as Mock).mockReturnValue(home);
    const dir = await mkdtemp(join(tmpdir(), "ygg-webhook-gw-"));

    const config = mergeConfig(DEFAULT_CONFIG, { gateway: { port: 0 } });
    gateway = await startGatewayServer({ config, workspaceRoot: dir, startChannels: false });
    const address = gateway.httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await gateway.close();
  });

  function registerFakeRunWebhook(result: unknown): void {
    registerGatewayMethod("workflows.runWebhook", async (params) => {
      received = params;
      return result;
    });
  }

  it("routes a POST with a bearer token through to workflows.runWebhook and maps its status", async () => {
    registerFakeRunWebhook({ ok: true, status: 200, run: { id: "r1", status: "succeeded" } });

    const res = await fetch(`${baseUrl}/hooks/workflows/wf1`, {
      method: "POST",
      headers: { Authorization: "Bearer s3cr3t", "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { status: string } };
    expect(body.run.status).toBe("succeeded");

    expect(received).toMatchObject({ id: "wf1", method: "POST", bearerToken: "s3cr3t", payload: { hello: "world" } });
    expect(received?.rawBody).toBe(JSON.stringify({ hello: "world" }));
  });

  it("extracts an HMAC signature header and the raw body for a POST", async () => {
    registerFakeRunWebhook({ ok: true, status: 200 });
    const rawBody = JSON.stringify({ n: 1 });
    const signatureHex = createHmac("sha256", "irrelevant-here").update(rawBody, "utf8").digest("hex");

    await fetch(`${baseUrl}/hooks/workflows/wf1`, {
      method: "POST",
      headers: { "X-Ygg-Signature": signatureHex },
      body: rawBody,
    });

    expect(received?.signatureHex).toBe(signatureHex);
    expect(received?.rawBody).toBe(rawBody);
  });

  it("maps query params to payload for a GET request", async () => {
    registerFakeRunWebhook({ ok: true, status: 200 });

    await fetch(`${baseUrl}/hooks/workflows/wf1?foo=bar&baz=qux`, { method: "GET" });

    expect(received).toMatchObject({ id: "wf1", method: "GET", payload: { foo: "bar", baz: "qux" } });
  });

  it("maps a 401 unauthorized result from the plugin straight through", async () => {
    registerFakeRunWebhook({ ok: false, status: 401, reason: "unauthorized" });

    const res = await fetch(`${baseUrl}/hooks/workflows/wf1`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, status: 401, reason: "unauthorized" });
  });

  it("returns 404 when no plugin has registered workflows.runWebhook at all", async () => {
    // Nothing registered in this test's registry — the route still resolves cleanly.
    const res = await fetch(`${baseUrl}/hooks/workflows/wf1`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("rate limits a workflow id after 10 requests within a minute", async () => {
    registerFakeRunWebhook({ ok: true, status: 200 });

    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/hooks/workflows/wf-rl`, { method: "POST" });
      expect(res.status).toBe(200);
    }
    const eleventh = await fetch(`${baseUrl}/hooks/workflows/wf-rl`, { method: "POST" });
    expect(eleventh.status).toBe(429);

    // A different workflow id is unaffected.
    const otherWorkflow = await fetch(`${baseUrl}/hooks/workflows/wf-other`, { method: "POST" });
    expect(otherWorkflow.status).toBe(200);
  });

  it("still serves the plain gateway health JSON on other paths", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "yggdrasil-gateway" });
  });
});
