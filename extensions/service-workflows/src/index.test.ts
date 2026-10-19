import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mock } from "vitest";

vi.mock("@yggdrasil/kernel", () => ({
  getKernelContext: vi.fn(),
}));

import { getKernelContext } from "@yggdrasil/kernel";
import { registerConnectionRemoteAddress } from "@yggdrasil/gateway";
import type { GatewayHandler, GatewayHandlerContext } from "@yggdrasil/sdk";
import type { Workflow } from "@yggdrasil/workflows";
import plugin from "./index.js";

type FakeApi = {
  registerGatewayMethod: Mock;
  registerService: Mock;
  events: { emit: Mock; on: Mock; off: Mock };
  gatewayMethods: Map<string, GatewayHandler>;
};

function fakeApi(): FakeApi {
  const gatewayMethods = new Map<string, GatewayHandler>();
  return {
    registerGatewayMethod: vi.fn((name: string, handler: GatewayHandler) => gatewayMethods.set(name, handler)),
    registerService: vi.fn(),
    events: { emit: vi.fn(() => Promise.resolve()), on: vi.fn(), off: vi.fn() },
    gatewayMethods,
  };
}

let nextLoopbackConnectionId = 0;
/** A connectionId `isLoopbackConnection` will treat as a real loopback (127.0.0.1) WS socket — see @yggdrasil/gateway's connectionRemoteAddress map. */
function loopbackConnectionId(): string {
  const id = `test-loopback-${nextLoopbackConnectionId++}`;
  registerConnectionRemoteAddress(id, "127.0.0.1");
  return id;
}

/** A connectionId positively registered as NOT loopback (e.g. a phone on the LAN) — distinct from an unregistered connectionId, which `isLoopbackConnection` also treats as non-loopback but for a different reason (no recorded address at all). */
function remoteConnectionId(): string {
  const id = `test-remote-${nextLoopbackConnectionId++}`;
  registerConnectionRemoteAddress(id, "192.168.1.50");
  return id;
}

/**
 * Defaults to a loopback connectionId (i.e. "this is the desktop app"),
 * since that's what every existing call site implicitly assumed before
 * workflows.run started distinguishing manual (loopback) from mobile
 * (anything else) — see the "manual vs. mobile trigger" describe block for
 * the tests that explicitly need a NON-loopback connection instead, via
 * `fakeCtx({ connectionId: "some-id" })` (a plain string nobody registered
 * as loopback fails closed the same way a real remote/unknown connection
 * would).
 */
function fakeCtx(opts: { connectionId?: string } = {}): GatewayHandlerContext & { events: { emit: Mock } } {
  return {
    config: {},
    events: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as unknown as GatewayHandlerContext["events"] & { emit: Mock },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as GatewayHandlerContext["logger"],
    connectionId: opts.connectionId ?? loopbackConnectionId(),
  } as GatewayHandlerContext & { events: { emit: Mock } };
}

const SETTINGS: Workflow["settings"] = {
  concurrency: "skip",
  timeoutMs: 600_000,
  allowRemoteTrigger: false,
  misfire: "skip",
  misfireGraceMs: 900_000,
};

function linearWorkflow(id: string): Workflow {
  return {
    id,
    name: "linear",
    version: 1,
    enabled: true,
    triggers: [{ id: "t1", type: "manual" }],
    nodes: [
      { id: "cond", type: "if", name: "cond", position: { x: 0, y: 0 }, params: { condition: { op: "eq", left: "vars.flag", right: true } } },
      { id: "a", type: "set", name: "a", position: { x: 0, y: 0 }, params: { name: "flag", value: true } },
    ],
    edges: [{ id: "e1", from: "cond", fromHandle: "true", to: "a" }],
    settings: SETTINGS,
  };
}

describe("service-workflows plugin registration", () => {
  it("registers exactly the phase-2/phase-4 workflows.* gateway methods", () => {
    const api = fakeApi();
    plugin.register(api as never);
    expect([...api.gatewayMethods.keys()].sort()).toEqual(
      [
        "workflows.artifacts.get",
        "workflows.cancel",
        "workflows.delete",
        "workflows.get",
        "workflows.grant",
        "workflows.grant.preview",
        "workflows.list",
        "workflows.nodeTypes",
        "workflows.revokeGrant",
        "workflows.run",
        "workflows.runWebhook",
        "workflows.runs.get",
        "workflows.runs.list",
        "workflows.save",
        "workflows.setEnabled",
        "workflows.validate",
      ].sort(),
    );
  });

  it("registers a service-workflows service that ticks the scheduler and subscribes event triggers", () => {
    const api = fakeApi();
    plugin.register(api as never);
    expect(api.registerService).toHaveBeenCalledTimes(1);
    const service = api.registerService.mock.calls[0]![0] as { id: string; start: (ctx: unknown) => void; stop: () => void };
    expect(service.id).toBe("service-workflows");
    expect(typeof service.start).toBe("function");
    expect(typeof service.stop).toBe("function");
  });

  it("workflows.nodeTypes lists exactly the node types this build has executors for", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const result = (await api.gatewayMethods.get("workflows.nodeTypes")!({}, fakeCtx())) as { nodeTypes: { type: string }[] };
    expect(result.nodeTypes.map((n) => n.type).sort()).toEqual(["agent.ask", "delay", "http.request", "if", "loop", "phone.tool", "set", "switch"]);
  });
});

describe("service-workflows CRUD", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-workflows-"));
    (getKernelContext as unknown as Mock).mockReturnValue({ workspaceRoot, config: {}, state: "running" });
  });

  it("workflows.validate reports errors for a bogus node type without saving anything", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const wf = linearWorkflow("wf1");
    wf.nodes[0]!.type = "desktop.screenshot"; // doesn't exist in this build
    const result = (await api.gatewayMethods.get("workflows.validate")!({ workflow: wf }, fakeCtx())) as { errors: unknown[] };
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("workflows.save refuses an invalid workflow (never writes it to disk)", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const wf = linearWorkflow("wf1");
    wf.edges = [{ id: "e1", from: "cond", fromHandle: "true", to: "ghost" }];
    await expect(api.gatewayMethods.get("workflows.save")!({ workflow: wf }, fakeCtx())).rejects.toThrow(/invalid/);
    await expect(api.gatewayMethods.get("workflows.get")!({ id: "wf1" }, fakeCtx())).rejects.toThrow(/no workflow/);
  });

  it("round-trips a valid workflow through save/get/list/delete", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const wf = linearWorkflow("wf1");

    await api.gatewayMethods.get("workflows.save")!({ workflow: wf }, fakeCtx());
    const got = (await api.gatewayMethods.get("workflows.get")!({ id: "wf1" }, fakeCtx())) as { workflow: Workflow };
    expect(got.workflow).toEqual(wf);

    const listed = (await api.gatewayMethods.get("workflows.list")!({}, fakeCtx())) as {
      workflows: { workflow: Workflow; grantStatus: string }[];
    };
    expect(listed.workflows.map((s) => s.workflow.id)).toEqual(["wf1"]);
    expect(listed.workflows[0]!.grantStatus).toBe("not_required");

    await api.gatewayMethods.get("workflows.delete")!({ id: "wf1" }, fakeCtx());
    await expect(api.gatewayMethods.get("workflows.get")!({ id: "wf1" }, fakeCtx())).rejects.toThrow(/no workflow/);
  });

  it("workflows.setEnabled toggles enabled and persists it", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: linearWorkflow("wf1") }, fakeCtx());

    const result = (await api.gatewayMethods.get("workflows.setEnabled")!({ id: "wf1", enabled: false }, fakeCtx())) as { workflow: Workflow };
    expect(result.workflow.enabled).toBe(false);

    const got = (await api.gatewayMethods.get("workflows.get")!({ id: "wf1" }, fakeCtx())) as { workflow: Workflow };
    expect(got.workflow.enabled).toBe(false);
  });
});

describe("service-workflows grants", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-workflows-grants-"));
    (getKernelContext as unknown as Mock).mockReturnValue({ workspaceRoot, config: {}, state: "running" });
  });

  it("workflows.grant.preview reports no risky nodes for a safe-only workflow", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: linearWorkflow("wf1") }, fakeCtx());

    const preview = (await api.gatewayMethods.get("workflows.grant.preview")!({ id: "wf1" }, fakeCtx())) as {
      graphHash: string;
      riskyNodes: unknown[];
    };
    expect(preview.riskyNodes).toEqual([]);
    expect(typeof preview.graphHash).toBe("string");
  });

  it("workflows.grant refuses a non-loopback connection", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: linearWorkflow("wf1") }, fakeCtx());
    const preview = (await api.gatewayMethods.get("workflows.grant.preview")!({ id: "wf1" }, fakeCtx())) as { graphHash: string };

    await expect(
      api.gatewayMethods.get("workflows.grant")!({ id: "wf1", graphHash: preview.graphHash }, fakeCtx({ connectionId: remoteConnectionId() })),
    ).rejects.toThrow(/loopback/);
  });

  it("workflows.grant refuses a stale graphHash", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: linearWorkflow("wf1") }, fakeCtx());

    await expect(
      api.gatewayMethods.get("workflows.grant")!({ id: "wf1", graphHash: "not-the-real-hash" }, fakeCtx({ connectionId: loopbackConnectionId() })),
    ).rejects.toThrow(/graphHash mismatch/);
  });

  it("grants from a loopback connection with a matching graphHash, and revoke removes it", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: linearWorkflow("wf1") }, fakeCtx());
    const preview = (await api.gatewayMethods.get("workflows.grant.preview")!({ id: "wf1" }, fakeCtx())) as { graphHash: string };

    const granted = (await api.gatewayMethods.get("workflows.grant")!(
      { id: "wf1", graphHash: preview.graphHash },
      fakeCtx({ connectionId: loopbackConnectionId() }),
    )) as { grant: { workflowId: string; graphHash: string; grantedBy: string } };
    expect(granted.grant).toMatchObject({ workflowId: "wf1", graphHash: preview.graphHash, grantedBy: "desktop" });

    const revoked = await api.gatewayMethods.get("workflows.revokeGrant")!({ id: "wf1" }, fakeCtx());
    expect(revoked).toEqual({ ok: true });
  });

});

describe("service-workflows execution", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-workflows-run-"));
    (getKernelContext as unknown as Mock).mockReturnValue({ workspaceRoot, config: {}, state: "running" });
  });

  it("workflows.run executes a saved workflow end to end, persists the run, and emits matching events", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const wf = linearWorkflow("wf1");
    wf.vars = { flag: true };
    await api.gatewayMethods.get("workflows.save")!({ workflow: wf }, fakeCtx());

    const ctx = fakeCtx();
    const result = (await api.gatewayMethods.get("workflows.run")!({ id: "wf1" }, ctx)) as { run: { id: string; status: string } };
    expect(result.run.status).toBe("succeeded");

    const emittedEvents = ctx.events.emit.mock.calls.map(([event, payload]) => ({ event, payload }));
    expect(emittedEvents.map((e) => e.event)).toEqual([
      "workflow.run.started",
      "workflow.node.started",
      "workflow.node.finished",
      "workflow.node.started",
      "workflow.node.finished",
      "workflow.run.finished",
    ]);
    // Every emitted event carries the SAME run id as the returned run — this
    // is what workflows.cancel needs to actually target the right run (a
    // real bug caught while writing this: the plugin used to pre-allocate
    // its own id instead of using the executor's).
    for (const { payload } of emittedEvents) {
      expect((payload as { runId: string }).runId).toBe(result.run.id);
    }

    const gotRun = (await api.gatewayMethods.get("workflows.runs.get")!({ runId: result.run.id }, fakeCtx())) as {
      run: { id: string };
    };
    expect(gotRun.run.id).toBe(result.run.id);

    const listedRuns = (await api.gatewayMethods.get("workflows.runs.list")!({ workflowId: "wf1" }, fakeCtx())) as {
      runs: { id: string }[];
    };
    expect(listedRuns.runs.map((r) => r.id)).toEqual([result.run.id]);
  });

  it("workflows.run from a non-loopback connection is refused when allowRemoteTrigger is false, with reason remote_trigger_denied", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: linearWorkflow("wf1") }, fakeCtx());

    const result = await api.gatewayMethods.get("workflows.run")!({ id: "wf1" }, fakeCtx({ connectionId: remoteConnectionId() }));
    expect(result).toEqual({ run: null, skipped: true, reason: "remote_trigger_denied" });
  });

  it("workflows.run from a non-loopback connection succeeds, as a \"mobile\" trigger, when allowRemoteTrigger is true", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const wf = linearWorkflow("wf1");
    wf.vars = { flag: true };
    wf.settings = { ...SETTINGS, allowRemoteTrigger: true };
    await api.gatewayMethods.get("workflows.save")!({ workflow: wf }, fakeCtx());

    const result = (await api.gatewayMethods.get("workflows.run")!({ id: "wf1" }, fakeCtx({ connectionId: remoteConnectionId() }))) as {
      run: { status: string; trigger: { id: string; type: string } };
    };
    expect(result.run.status).toBe("succeeded");
    expect(result.run.trigger).toEqual({ id: "mobile", type: "mobile", payload: undefined });
  });

  it("workflows.run rejects an unknown workflow id", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await expect(api.gatewayMethods.get("workflows.run")!({ id: "ghost" }, fakeCtx())).rejects.toThrow(/no workflow/);
  });

  it("workflows.cancel with an unknown runId reports it wasn't in flight, without throwing", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const result = await api.gatewayMethods.get("workflows.cancel")!({ runId: "not-a-real-run" }, fakeCtx());
    expect(result).toEqual({ ok: false, reason: "no in-flight run with that id" });
  });

  it("workflows.cancel aborts a run that's still in flight, using the id from workflow.run.started", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const wf: Workflow = {
      id: "wf-slow",
      name: "slow",
      version: 1,
      enabled: true,
      triggers: [{ id: "t1", type: "manual" }],
      nodes: [{ id: "a", type: "delay", name: "a", position: { x: 0, y: 0 }, params: { ms: 5000 } }],
      edges: [],
      settings: SETTINGS,
    };
    await api.gatewayMethods.get("workflows.save")!({ workflow: wf }, fakeCtx());

    const ctx = fakeCtx();
    let capturedRunId: string | undefined;
    ctx.events.emit.mockImplementation((event: string, payload: { runId: string }) => {
      if (event === "workflow.run.started") capturedRunId = payload.runId;
      return Promise.resolve();
    });

    const runPromise = api.gatewayMethods.get("workflows.run")!({ id: "wf-slow" }, ctx);
    // Give the run a tick to actually start and emit run.started before cancelling.
    await new Promise((r) => setTimeout(r, 10));
    expect(capturedRunId).toBeDefined();

    const cancelResult = await api.gatewayMethods.get("workflows.cancel")!({ runId: capturedRunId }, fakeCtx());
    expect(cancelResult).toEqual({ ok: true });

    const result = (await runPromise) as { run: { status: string } };
    expect(result.run.status).toBe("cancelled");
  });
});

describe("service-workflows webhook trigger", () => {
  let workspaceRoot: string;
  const SECRET_ENV = "YGG_TEST_INDEX_WEBHOOK_SECRET";

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-workflows-webhook-"));
    (getKernelContext as unknown as Mock).mockReturnValue({ workspaceRoot, config: {}, state: "running" });
    process.env[SECRET_ENV] = "s3cr3t";
  });

  function webhookWorkflow(id: string, overrides: Partial<Workflow> = {}): Workflow {
    return {
      id,
      name: "hooked",
      version: 1,
      enabled: true,
      triggers: [{ id: "hook", type: "webhook", secretRef: SECRET_ENV, method: "POST" }],
      nodes: [{ id: "a", type: "set", name: "a", position: { x: 0, y: 0 }, params: { name: "x", value: 1 } }],
      edges: [],
      settings: { concurrency: "skip", timeoutMs: 600_000, allowRemoteTrigger: true, misfire: "skip", misfireGraceMs: 900_000 },
      ...overrides,
    };
  }

  it("runs the workflow when the bearer token matches the secret env var", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: webhookWorkflow("wf-hook") }, fakeCtx());

    const result = (await api.gatewayMethods.get("workflows.runWebhook")!({ id: "wf-hook", method: "POST", bearerToken: "s3cr3t" }, fakeCtx())) as {
      ok: boolean;
      run?: { status: string };
    };
    expect(result.ok).toBe(true);
    expect(result.run?.status).toBe("succeeded");
  });

  it("rejects a wrong bearer token without running the workflow", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: webhookWorkflow("wf-hook") }, fakeCtx());

    const result = (await api.gatewayMethods.get("workflows.runWebhook")!({ id: "wf-hook", method: "POST", bearerToken: "wrong" }, fakeCtx())) as {
      ok: boolean;
      status: number;
      reason: string;
    };
    expect(result).toEqual({ ok: false, status: 401, reason: "unauthorized" });
    expect(await api.gatewayMethods.get("workflows.runs.list")!({ workflowId: "wf-hook" }, fakeCtx())).toEqual({ runs: [] });
  });

  it("rejects when allowRemoteTrigger is false, even with a correct bearer token", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const wf = webhookWorkflow("wf-hook", { settings: { concurrency: "skip", timeoutMs: 600_000, allowRemoteTrigger: false, misfire: "skip", misfireGraceMs: 900_000 } });
    await api.gatewayMethods.get("workflows.save")!({ workflow: wf }, fakeCtx());

    const result = await api.gatewayMethods.get("workflows.runWebhook")!({ id: "wf-hook", method: "POST", bearerToken: "s3cr3t" }, fakeCtx());
    expect(result).toEqual({ ok: false, status: 403, reason: "remote_trigger_denied" });
  });

  it("returns not_found for an unknown workflow id", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const result = await api.gatewayMethods.get("workflows.runWebhook")!({ id: "ghost", method: "POST" }, fakeCtx());
    expect(result).toEqual({ ok: false, status: 404, reason: "not_found" });
  });
});
