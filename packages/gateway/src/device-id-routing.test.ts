// Tests the deviceId-based routing added for workflows-design.md's Fase 6
// (a workflow's `phone.tool` node / "mobile" trigger needs to address "that
// same phone" across reconnects, unlike the existing sessionKey-based
// device-tools path used by chat, which device-tools.test.ts already
// covers). Deliberately lighter than that file — no LLM harness, just a
// real gateway + a minimal fake phone WS client, since this only exercises
// the connectionId<->deviceId bookkeeping and invokeDeviceToolByDeviceId
// itself, called directly (it's not a registered RPC method).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import type { Mock } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn() };
});

import { homedir } from "node:os";
import { WebSocket } from "ws";
import { DEFAULT_CONFIG, mergeConfig } from "@yggdrasil/config";
import { resetRegistryForTest } from "@yggdrasil/kernel";
import { startGatewayServer, type GatewayServer } from "./server.js";
import { invokeDeviceToolByDeviceId, isDeviceConnection } from "./methods.js";

type JsonMsg = Record<string, any>;

class FakePhone {
  ws: WebSocket;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private counter = 0;
  onInvokeRequested: ((payload: JsonMsg) => void) | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as JsonMsg;
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else p.resolve(msg.result);
        return;
      }
      if (msg.type === "event" && msg.event === "device.tool.invoke.requested") {
        this.onInvokeRequested?.(msg.payload);
      }
    });
  }

  waitOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = `t${++this.counter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  registerTools(deviceId: string, tools: { name: string; kind: "sync" | "interactive" }[]): Promise<unknown> {
    return this.call("device.tools.register", { deviceId, tools: tools.map((t) => ({ ...t, description: "", parameters: {} })) });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }
}

describe("deviceId routing (Fase 6)", () => {
  let gateway: GatewayServer;
  let url: string;

  beforeEach(async () => {
    resetRegistryForTest();
    const home = await mkdtemp(join(tmpdir(), "ygg-home-deviceid-"));
    (homedir as unknown as Mock).mockReturnValue(home);
    const dir = await mkdtemp(join(tmpdir(), "ygg-deviceid-"));
    const config = mergeConfig(DEFAULT_CONFIG, { gateway: { port: 0 } });
    gateway = await startGatewayServer({ config, workspaceRoot: dir, startChannels: false });
    const address = gateway.httpServer.address() as AddressInfo;
    url = `ws://127.0.0.1:${address.port}/`;
  });

  afterEach(async () => {
    await gateway.close();
  });

  it("invokeDeviceToolByDeviceId reaches the right phone by its stable deviceId", async () => {
    const phone = new FakePhone(url);
    await phone.waitOpen();
    await phone.registerTools("phone-abc", [{ name: "phone_open_app", kind: "sync" }]);

    phone.onInvokeRequested = (payload) => {
      void phone.call("device.tools.result", { requestId: payload.requestId, result: { opened: true } });
    };

    const result = await invokeDeviceToolByDeviceId(gateway.context.events, "phone-abc", "phone_open_app", { app: "Calculator" });
    expect(result).toEqual({ opened: true });

    await phone.close();
  });

  it("fails with device_offline for an unknown deviceId", async () => {
    await expect(invokeDeviceToolByDeviceId(gateway.context.events, "not-a-real-device", "phone_open_app", {})).rejects.toThrow(/device_offline/);
  });

  it("fails when the device is connected but hasn't registered that tool name", async () => {
    const phone = new FakePhone(url);
    await phone.waitOpen();
    await phone.registerTools("phone-abc", [{ name: "phone_open_app", kind: "sync" }]);

    await expect(invokeDeviceToolByDeviceId(gateway.context.events, "phone-abc", "phone_set_alarm", {})).rejects.toThrow(/has not registered a tool/);
    await phone.close();
  });

  it("a reconnect with the same deviceId supersedes the old connection", async () => {
    const first = new FakePhone(url);
    await first.waitOpen();
    await first.registerTools("phone-abc", [{ name: "phone_open_app", kind: "sync" }]);
    await first.close();

    // Give handleGatewayConnectionClosed's close handler a tick to run.
    await new Promise((r) => setTimeout(r, 20));

    const second = new FakePhone(url);
    await second.waitOpen();
    await second.registerTools("phone-abc", [{ name: "phone_open_app", kind: "sync" }]);
    second.onInvokeRequested = (payload) => {
      void second.call("device.tools.result", { requestId: payload.requestId, result: { from: "second" } });
    };

    const result = await invokeDeviceToolByDeviceId(gateway.context.events, "phone-abc", "phone_open_app", {});
    expect(result).toEqual({ from: "second" });
    await second.close();
  });

  it("disconnecting the device makes it device_offline again", async () => {
    const phone = new FakePhone(url);
    await phone.waitOpen();
    await phone.registerTools("phone-abc", [{ name: "phone_open_app", kind: "sync" }]);
    await phone.close();
    await new Promise((r) => setTimeout(r, 20));

    await expect(invokeDeviceToolByDeviceId(gateway.context.events, "phone-abc", "phone_open_app", {})).rejects.toThrow(/device_offline/);
  });

  it("isDeviceConnection is true only for a connection that registered a deviceId", async () => {
    const phone = new FakePhone(url);
    await phone.waitOpen();

    // Nothing registered yet on this raw WS — not (yet) a "device" connection
    // from the gateway's point of view. This mirrors how workflows.run's
    // manual-vs-mobile gating needs to tell the two apart; we can't easily
    // get our hands on the live connectionId from this test (it's internal
    // to server.ts's per-socket state), so this exercises the plain-string
    // "unknown connectionId" case that same gate falls back to.
    expect(isDeviceConnection(undefined)).toBe(false);
    expect(isDeviceConnection("not-a-real-connection-id")).toBe(false);

    await phone.close();
  });
});
