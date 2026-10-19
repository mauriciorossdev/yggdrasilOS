// Smoke/integration test for the device-tools protocol (see
// notes/yggdrasil-mobile/phone-gateway-connectivity-design.md section 3).
// Runs a real gateway (real HTTP+WS server, real network sockets) and drives
// it with a fake "phone" WS client that speaks the exact protocol
// mobile/app/lib/services/yggdrasil_client.dart implements — this is not
// invokeGatewayMethod-style in-process calling, because device.tools.* only
// makes sense with a real per-connection identity (connectionId), which only
// exists for real WS connections (see GatewayMethodHandler's connectionId
// param and server.ts's per-socket randomUUID()).
//
// Uses the REAL @yggdrasil/harness-llm harness (createLlmHarness) — not a
// hand-rolled stand-in — so the real tool-loop.ts decision/approval logic
// and the real onToolExecute -> "tool.execute" event wiring run exactly as
// they would in production. Only the LLM API call itself is scripted, via a
// fake ProviderPlugin registered per test.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import type { Mock } from "vitest";

// Same reasoning as config-methods.test.ts: without this, readGlobalAgents()
// (called from createDefaultGatewayContext) reads the real ~/.yggdrasil, and
// the default session store dir falls back to ~/.yggdrasil/sessions too.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn() };
});

import { homedir } from "node:os";
import { WebSocket } from "ws";
import { DEFAULT_CONFIG, mergeConfig } from "@yggdrasil/config";
import { registerHarness, registerProvider, resetRegistryForTest } from "@yggdrasil/kernel";
import { resetSessionStoreForTest } from "@yggdrasil/sessions";
import { createLlmHarness } from "@yggdrasil/harness-llm";
import type { ProviderPlugin } from "@yggdrasil/sdk";
import { startGatewayServer, type GatewayServer } from "./server.js";

const DEVICE_TEST_PROVIDER_ID = "device-test-provider";

// Scripts the LLM's first turn as a single tool_calls response naming
// `toolName`, and its second turn (after the tool result comes back) as a
// plain "done" — exercises the real tool-loop.ts end to end without needing
// a live LLM.
function registerScriptedToolCallProvider(toolName: string, args: Record<string, unknown>): void {
  let call = 0;
  const provider: ProviderPlugin = {
    id: DEVICE_TEST_PROVIDER_ID,
    label: "Scripted",
    listModels: () => [],
    chatComplete: async () => {
      call++;
      if (call === 1) {
        return {
          text: "",
          model: "m",
          finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: toolName, arguments: JSON.stringify(args) }],
        };
      }
      return { text: "done", model: "m", finishReason: "stop" };
    },
  };
  registerProvider(provider);
}

type JsonMsg = Record<string, any>;

class FakePhone {
  ws: WebSocket;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private counter = 0;
  autoApprove = true;
  onInvokeRequested: ((payload: JsonMsg) => void) | null = null;
  events: JsonMsg[] = [];

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

      if (msg.type === "event") {
        this.events.push(msg);
        if (msg.event === "tool.approval.requested" && this.autoApprove) {
          void this.call("tools.approve", { requestId: msg.payload.requestId, approved: true });
        }
        if (msg.event === "device.tool.invoke.requested") {
          this.onInvokeRequested?.(msg.payload);
        }
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

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }
}

describe("device-tools protocol (gateway-side)", () => {
  let dir: string;
  let gateway: GatewayServer;
  let url: string;

  beforeEach(async () => {
    resetRegistryForTest();
    resetSessionStoreForTest();
    registerHarness(createLlmHarness());

    const home = await mkdtemp(join(tmpdir(), "ygg-home-devtools-"));
    (homedir as unknown as Mock).mockReturnValue(home);
    dir = await mkdtemp(join(tmpdir(), "ygg-devtools-"));

    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [{ id: "default", provider: DEVICE_TEST_PROVIDER_ID, model: "x" }],
      sessions: { dir },
      gateway: { port: 0 },
    });

    gateway = await startGatewayServer({ config, workspaceRoot: dir, startChannels: false });
    const address = gateway.httpServer.address() as AddressInfo;
    url = `ws://127.0.0.1:${address.port}/`;
  });

  afterEach(async () => {
    await gateway.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("registers device tools without METHOD_NOT_FOUND", async () => {
    const phone = new FakePhone(url);
    await phone.waitOpen();

    const result = (await phone.call("device.tools.register", {
      tools: [
        {
          name: "phone_open_app",
          description: "Open an installed app",
          parameters: {
            type: "object",
            properties: { packageName: { type: "string" } },
            required: ["packageName"],
          },
          kind: "sync",
        },
      ],
    })) as { ok: boolean; registered: number };

    expect(result.ok).toBe(true);
    expect(result.registered).toBe(1);
    await phone.close();
  });

  it("rejects a device tool registration missing kind", async () => {
    const phone = new FakePhone(url);
    await phone.waitOpen();

    await expect(
      phone.call("device.tools.register", { tools: [{ name: "bad_tool", description: "x", parameters: {} }] }),
    ).rejects.toThrow(/kind/);

    await phone.close();
  });

  it("full round trip: chat.send -> device.tool.invoke.requested -> device.tools.result -> tool.execute event, no approval dialog for a riskLevel:safe tool", async () => {
    registerScriptedToolCallProvider("phone_open_app", { packageName: "com.example.test" });

    const phone = new FakePhone(url);
    await phone.waitOpen();

    phone.onInvokeRequested = (payload) => {
      expect(payload.toolName).toBe("phone_open_app");
      expect(payload.kind).toBe("sync");
      expect(payload.args).toEqual({ packageName: "com.example.test" });
      void phone.call("device.tools.result", {
        requestId: payload.requestId,
        ok: true,
        result: { launched: true },
      });
    };

    await phone.call("device.tools.register", {
      tools: [
        {
          name: "phone_open_app",
          description: "Open an installed app",
          parameters: { type: "object", properties: { packageName: { type: "string" } } },
          kind: "sync",
        },
      ],
    });

    const chatResult = (await phone.call("chat.send", {
      message: "open the test app",
      sessionKey: "phone-session-1",
    })) as { reply: string };

    // The real tool loop continues after the tool result and produces the
    // scripted final turn — the device tool's own result isn't the chat
    // reply, it's what tool.execute below reports.
    expect(chatResult.reply).toBe("done");

    // tools.list for that sessionKey now shows the merged device tool, with
    // gateway-assigned kind + riskLevel (never client-declared).
    const listResult = (await phone.call("tools.list", { sessionKey: "phone-session-1" })) as {
      tools: Array<{ name: string; kind?: string; riskLevel?: string }>;
    };
    const registered = listResult.tools.find((t) => t.name === "phone_open_app");
    expect(registered?.kind).toBe("sync");
    expect(registered?.riskLevel).toBe("safe");

    // The actual gap this round was about: tool.execute must fire for a
    // device tool call exactly like it does for a server-side one — same
    // event, same payload shape, via the shared onToolExecute wiring in
    // harness-llm's harness.ts (not a device-tools-specific emit).
    const toolExecuteEvent = phone.events.find((e) => e.event === "tool.execute");
    expect(toolExecuteEvent?.payload).toMatchObject({
      sessionKey: "phone-session-1",
      toolName: "phone_open_app",
      status: "ok",
      args: { packageName: "com.example.test" },
      result: JSON.stringify({ launched: true }),
    });

    // riskLevel:"safe" means no approval dialog in the default "auto" mode —
    // the SAF-picker-equivalent checkpoint doesn't exist for open_app, and
    // this tool has no human-facing checkpoint at all, so it must just run.
    expect(phone.events.some((e) => e.event === "tool.approval.requested")).toBe(false);

    await phone.close();
  });

  it("riskLevel is assigned server-side by name — known v1 tools are safe, an unrecognized name fails closed to destructive", async () => {
    const phone = new FakePhone(url);
    await phone.waitOpen();

    await phone.call("device.tools.register", {
      tools: [
        {
          name: "phone_list_installed_apps",
          description: "List installed apps",
          parameters: { type: "object", properties: {} },
          kind: "sync",
        },
        {
          name: "phone_search_files",
          description: "Search files via SAF picker",
          parameters: { type: "object", properties: {} },
          kind: "interactive",
        },
        {
          name: "phone_list_documents",
          description: "List documents via SAF picker",
          parameters: { type: "object", properties: {} },
          kind: "interactive",
        },
        {
          // Not in the v1 mapping — must fail closed, not inherit some
          // permissive default.
          name: "phone_send_sms",
          description: "Not a real v1 tool",
          parameters: { type: "object", properties: {} },
          kind: "sync",
        },
        {
          // Writes real device state (unlike the reads/no-ops above) with no
          // human checkpoint of its own when kind:"sync" — fail-closed to
          // "moderate", not "safe" (external-actions-and-connectors-
          // analysis.md §2.1 correction).
          name: "phone_set_alarm",
          description: "Set an alarm via AlarmClock.ACTION_SET_ALARM",
          parameters: {
            type: "object",
            properties: { hour: { type: "integer" }, minute: { type: "integer" }, label: { type: "string" } },
            required: ["hour", "minute"],
          },
          kind: "sync",
        },
        {
          // Same reasoning as set_alarm — no result contract from
          // ACTION_SET_TIMER either.
          name: "phone_set_timer",
          description: "Set a timer via AlarmClock.ACTION_SET_TIMER",
          parameters: {
            type: "object",
            properties: { seconds: { type: "integer" }, label: { type: "string" } },
            required: ["seconds"],
          },
          kind: "sync",
        },
        {
          // Confirmed real human checkpoint (ACTION_INSERT always opens the
          // Calendar editor) — still "moderate", not "safe", because the
          // event can reach a third party (shared/work calendar invite).
          name: "phone_add_calendar_event",
          description: "Add a calendar event via ACTION_INSERT on CalendarContract",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              location: { type: "string" },
              description: { type: "string" },
              startDateTime: { type: "string" },
              endDateTime: { type: "string" },
              allDay: { type: "boolean" },
            },
            required: ["title", "startDateTime"],
          },
          kind: "sync",
        },
      ],
    });

    // Links this connection's device tools to the session, same as the
    // round-trip test — tools.list only merges for a session that's been
    // linked via chat.send. No provider is registered for this test, so the
    // harness falls back to the builtin echo harness — fine, this test only
    // cares about the sessionKey->connectionId link, not the reply.
    await phone.call("chat.send", { message: "noop", sessionKey: "phone-session-risklevel" });

    const listResult = (await phone.call("tools.list", { sessionKey: "phone-session-risklevel" })) as {
      tools: Array<{ name: string; riskLevel?: string }>;
    };
    const byName = (name: string) => listResult.tools.find((t) => t.name === name)?.riskLevel;

    expect(byName("phone_list_installed_apps")).toBe("safe");
    expect(byName("phone_search_files")).toBe("safe");
    expect(byName("phone_list_documents")).toBe("safe");
    expect(byName("phone_send_sms")).toBe("destructive");
    expect(byName("phone_set_alarm")).toBe("moderate");
    expect(byName("phone_set_timer")).toBe("moderate");
    expect(byName("phone_add_calendar_event")).toBe("moderate");

    await phone.close();
  });

  it("device.tools.result on an unknown requestId errors instead of silently succeeding", async () => {
    const phone = new FakePhone(url);
    await phone.waitOpen();

    await expect(
      phone.call("device.tools.result", { requestId: "does-not-exist", ok: true, result: {} }),
    ).rejects.toThrow(/no pending device tool call/i);

    await phone.close();
  });

  it(
    "sync timeout: no device.tools.result within the sync window surfaces as a failed tool.execute (error: timeout), and the real tool loop still finishes the turn",
    async () => {
      registerScriptedToolCallProvider("phone_open_app", { packageName: "com.example.test" });

      const phone = new FakePhone(url);
      await phone.waitOpen();
      phone.onInvokeRequested = () => {
        // deliberately never reply — DEVICE_TOOL_SYNC_TIMEOUT_MS should fire.
      };

      await phone.call("device.tools.register", {
        tools: [
          {
            name: "phone_open_app",
            description: "x",
            parameters: { type: "object", properties: {} },
            kind: "sync",
          },
        ],
      });

      const chatResult = (await phone.call("chat.send", {
        message: "open the test app",
        sessionKey: "phone-session-timeout",
      })) as { reply: string };

      // A real LLM tool loop doesn't die on a tool error — it sees the error
      // as the tool-role message content and produces its next (scripted)
      // turn regardless.
      expect(chatResult.reply).toBe("done");

      const toolExecuteEvent = phone.events.find((e) => e.event === "tool.execute");
      expect(toolExecuteEvent?.payload).toMatchObject({
        sessionKey: "phone-session-timeout",
        toolName: "phone_open_app",
        status: "error",
      });
      expect(toolExecuteEvent?.payload.error).toMatch(/timeout/);

      await phone.close();
    },
    40_000,
  );
});
