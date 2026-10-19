// End-to-end grant preflight/lifecycle tests. Every node type in the real
// nodeTypes.ts catalog is `safe` (phase 4 shipped none of the moderate/
// destructive desktop/agent/http types yet — those land in later phases),
// which means the grant_required gate in run.ts is otherwise unreachable in
// this build. This file mocks nodeTypes.js to introduce one synthetic
// "test.risky" node type so the real gating logic (executeWorkflowRun,
// workflows.run, workflows.list's grantStatus) can be exercised honestly
// end to end, without waiting for a later phase's real risky node types.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mock } from "vitest";

vi.mock("@yggdrasil/kernel", () => ({
  getKernelContext: vi.fn(),
}));

vi.mock("./nodeTypes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nodeTypes.js")>();
  return {
    ...actual,
    KNOWN_NODE_TYPES: new Set([...actual.KNOWN_NODE_TYPES, "test.risky"]),
    riskLevelForNodeType: (type: string) => (type === "test.risky" ? "moderate" : actual.riskLevelForNodeType(type)),
    // run.ts calls riskLevelForNode (param-aware), not riskLevelForNodeType
    // directly — override both, since a function's internal call to a
    // sibling export inside nodeTypes.ts's own source isn't affected by
    // vi.mock overriding the export object a CONSUMER sees.
    riskLevelForNode: (node: { type: string; params: Record<string, unknown> }) =>
      node.type === "test.risky" ? "moderate" : actual.riskLevelForNode(node),
  };
});

import { getKernelContext } from "@yggdrasil/kernel";
import { registerConnectionRemoteAddress } from "@yggdrasil/gateway";
import type { GatewayHandler, GatewayHandlerContext } from "@yggdrasil/sdk";
import type { Workflow } from "@yggdrasil/workflows";
import plugin from "./index.js";

type FakeApi = { registerGatewayMethod: Mock; registerService: Mock; events: { emit: Mock }; gatewayMethods: Map<string, GatewayHandler> };

function fakeApi(): FakeApi {
  const gatewayMethods = new Map<string, GatewayHandler>();
  return {
    registerGatewayMethod: vi.fn((name: string, handler: GatewayHandler) => gatewayMethods.set(name, handler)),
    registerService: vi.fn(),
    events: { emit: vi.fn(() => Promise.resolve()) },
    gatewayMethods,
  };
}

let nextConnId = 0;
function loopbackConnectionId(): string {
  const id = `grant-test-loopback-${nextConnId++}`;
  registerConnectionRemoteAddress(id, "127.0.0.1");
  return id;
}

// Defaults to loopback ("this is the desktop app") — see
// index.test.ts's fakeCtx for why: workflows.run now distinguishes manual
// (loopback) from mobile (anything else), and every call site here already
// implicitly assumed "the desktop" before that gate existed.
function fakeCtx(opts: { connectionId?: string } = {}): GatewayHandlerContext {
  return {
    config: {},
    events: { emit: vi.fn(() => Promise.resolve()), on: vi.fn(), off: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    connectionId: opts.connectionId ?? loopbackConnectionId(),
  };
}

const SETTINGS: Workflow["settings"] = { concurrency: "skip", timeoutMs: 600_000, allowRemoteTrigger: false, misfire: "skip", misfireGraceMs: 900_000 };

function riskyWorkflow(id: string): Workflow {
  return {
    id,
    name: "risky",
    version: 1,
    enabled: true,
    triggers: [{ id: "t1", type: "manual" }],
    nodes: [{ id: "a", type: "test.risky", name: "a", position: { x: 0, y: 0 }, params: {} }],
    edges: [],
    settings: SETTINGS,
  };
}

describe("grant preflight and lifecycle (with a synthetic risky node type)", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-grant-"));
    (getKernelContext as unknown as Mock).mockReturnValue({ workspaceRoot, config: {}, state: "running" });
  });

  it("workflows.grant.preview reports the risky node", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: riskyWorkflow("wf1") }, fakeCtx());

    const preview = (await api.gatewayMethods.get("workflows.grant.preview")!({ id: "wf1" }, fakeCtx())) as {
      riskyNodes: { nodeId: string; tool: string; riskLevel: string }[];
    };
    expect(preview.riskyNodes).toEqual([{ nodeId: "a", tool: "test.risky", riskLevel: "moderate" }]);
  });

  it("workflows.list reports grantStatus \"none\" for an ungranted risky workflow", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: riskyWorkflow("wf1") }, fakeCtx());

    const listed = (await api.gatewayMethods.get("workflows.list")!({}, fakeCtx())) as { workflows: { grantStatus: string }[] };
    expect(listed.workflows[0]!.grantStatus).toBe("none");
  });

  it("workflows.run refuses to run an ungranted risky workflow, with reason grant_required", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: riskyWorkflow("wf1") }, fakeCtx());

    const result = (await api.gatewayMethods.get("workflows.run")!({ id: "wf1" }, fakeCtx())) as { run: null; skipped: true; reason: string };
    expect(result).toEqual({ run: null, skipped: true, reason: "grant_required" });
  });

  it("granting the exact current graphHash lets workflows.run proceed, and workflows.list flips to \"granted\"", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: riskyWorkflow("wf1") }, fakeCtx());
    const preview = (await api.gatewayMethods.get("workflows.grant.preview")!({ id: "wf1" }, fakeCtx())) as { graphHash: string };
    await api.gatewayMethods.get("workflows.grant")!({ id: "wf1", graphHash: preview.graphHash }, fakeCtx({ connectionId: loopbackConnectionId() }));

    const listed = (await api.gatewayMethods.get("workflows.list")!({}, fakeCtx())) as { workflows: { grantStatus: string }[] };
    expect(listed.workflows[0]!.grantStatus).toBe("granted");

    // The node type has no real executor registered (it's synthetic), so the
    // run itself fails internally — but the point here is that it got PAST
    // the grant gate at all, unlike the ungranted case above.
    const result = (await api.gatewayMethods.get("workflows.run")!({ id: "wf1" }, fakeCtx())) as { run: { status: string } | null; reason?: string };
    expect(result.reason).not.toBe("grant_required");
    expect(result.run).not.toBeNull();
  });

  it("editing a granted workflow makes its grant stale, and blocks the run again", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const wf = riskyWorkflow("wf1");
    await api.gatewayMethods.get("workflows.save")!({ workflow: wf }, fakeCtx());
    const preview = (await api.gatewayMethods.get("workflows.grant.preview")!({ id: "wf1" }, fakeCtx())) as { graphHash: string };
    await api.gatewayMethods.get("workflows.grant")!({ id: "wf1", graphHash: preview.graphHash }, fakeCtx({ connectionId: loopbackConnectionId() }));

    // Cosmetic-only change (position) does NOT change the graphHash (hash.ts
    // excludes position/name) — grant should still hold.
    const cosmetic = { ...wf, nodes: [{ ...wf.nodes[0]!, position: { x: 50, y: 50 } }] };
    await api.gatewayMethods.get("workflows.save")!({ workflow: cosmetic }, fakeCtx());
    let listed = (await api.gatewayMethods.get("workflows.list")!({}, fakeCtx())) as { workflows: { grantStatus: string }[] };
    expect(listed.workflows[0]!.grantStatus).toBe("granted");

    // A real param change DOES change the graphHash — grant goes stale.
    const changed = { ...wf, nodes: [{ ...wf.nodes[0]!, params: { changed: true } }] };
    await api.gatewayMethods.get("workflows.save")!({ workflow: changed }, fakeCtx());
    listed = (await api.gatewayMethods.get("workflows.list")!({}, fakeCtx())) as { workflows: { grantStatus: string }[] };
    expect(listed.workflows[0]!.grantStatus).toBe("stale");

    const result = (await api.gatewayMethods.get("workflows.run")!({ id: "wf1" }, fakeCtx())) as { reason?: string };
    expect(result.reason).toBe("grant_required");
  });

  it("revoking a grant makes workflows.run require a grant again", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    await api.gatewayMethods.get("workflows.save")!({ workflow: riskyWorkflow("wf1") }, fakeCtx());
    const preview = (await api.gatewayMethods.get("workflows.grant.preview")!({ id: "wf1" }, fakeCtx())) as { graphHash: string };
    await api.gatewayMethods.get("workflows.grant")!({ id: "wf1", graphHash: preview.graphHash }, fakeCtx({ connectionId: loopbackConnectionId() }));

    await api.gatewayMethods.get("workflows.revokeGrant")!({ id: "wf1" }, fakeCtx());

    const result = (await api.gatewayMethods.get("workflows.run")!({ id: "wf1" }, fakeCtx())) as { reason?: string };
    expect(result.reason).toBe("grant_required");
  });
});
