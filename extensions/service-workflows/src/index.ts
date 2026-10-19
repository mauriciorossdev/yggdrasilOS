import { join } from "node:path";
import { definePlugin } from "@yggdrasil/sdk";
import { getKernelContext } from "@yggdrasil/kernel";
import { isLoopbackConnection, invokeDeviceToolByDeviceId } from "@yggdrasil/gateway";
import { setDeviceToolInvoker } from "@yggdrasil/tools-runtime";
import { computeGraphHash, validateWorkflow, type Grant, type Workflow } from "@yggdrasil/workflows";
import { WorkflowStore } from "./store.js";
import { KNOWN_NODE_TYPES, NODE_TYPES } from "./nodeTypes.js";
import { activeRuns, computeRiskyNodes, executeWorkflowRun, grantStatusFor } from "./run.js";
import { Scheduler } from "./scheduler.js";
import { registerEventTriggers } from "./eventTriggers.js";
import { verifyWebhookAuth } from "./webhookAuth.js";

function requireWorkspaceRoot(methodName: string): string {
  const workspaceRoot = getKernelContext()?.workspaceRoot;
  if (!workspaceRoot) throw new Error(`${methodName}: no workspaceRoot configured for this gateway`);
  return workspaceRoot;
}

function storeFor(workspaceRoot: string): WorkflowStore {
  const definitionsDir = join(workspaceRoot, ".yggdrasil", "workflows");
  // Falls back to a workspace-local state dir so `yggdrasil run` works with
  // zero setup outside the desktop app too (same "no additional
  // configuration" posture as service-cron) — the desktop app overrides this
  // with a real userData path via YGGDRASIL_WORKFLOW_STATE_DIR
  // (workflows-design.md §2.4), since grants/runs must never live in the
  // committed project repo.
  const stateDir = process.env.YGGDRASIL_WORKFLOW_STATE_DIR ?? join(definitionsDir, ".state");
  return new WorkflowStore(definitionsDir, stateDir);
}

function requireWorkflow(value: unknown, methodName: string): Workflow {
  if (!value || typeof value !== "object") throw new Error(`${methodName}: \`workflow\` is required`);
  const wf = value as Partial<Workflow>;
  if (!wf.id || !Array.isArray(wf.nodes) || !Array.isArray(wf.edges) || !Array.isArray(wf.triggers)) {
    throw new Error(`${methodName}: \`workflow\` is missing required fields (id, nodes, edges, triggers)`);
  }
  return wf as Workflow;
}

const plugin = definePlugin({
  id: "service-workflows",
  name: "Workflow Automations",
  version: "0.1.0-beta.1",
  register(api) {
    // Lets the `phone.tool` node reach a device by its stable deviceId
    // (packages/gateway/src/methods.ts's invokeDeviceToolByDeviceId) without
    // @yggdrasil/tools-runtime (an I/O-agnostic package) knowing anything
    // about WS connections — same shape as the existing device-tool
    // provider hook for chat, see resolve.ts. `events` is NOT bound to
    // `api.events` here on purpose (that's a different, non-broadcast bus
    // than the one server.ts forwards to WS clients — see resolve.ts's
    // DeviceToolInvoker doc comment) — the caller passes in the real
    // per-run bus each time, threaded down via NodeExecutionContext.deviceEvents.
    setDeviceToolInvoker((events, deviceId, toolName, args) =>
      invokeDeviceToolByDeviceId(events as Parameters<typeof invokeDeviceToolByDeviceId>[0], deviceId, toolName, args),
    );

    api.registerGatewayMethod("workflows.nodeTypes", async () => ({ nodeTypes: NODE_TYPES }));

    api.registerGatewayMethod("workflows.list", async () => {
      const store = storeFor(requireWorkspaceRoot("workflows.list"));
      const workflows = await store.listWorkflows();
      const summaries = await Promise.all(
        workflows.map(async (workflow) => {
          const graphHash = computeGraphHash(workflow);
          const grant = await store.getGrant(workflow.id);
          return { workflow, grantStatus: grantStatusFor(workflow, grant, graphHash) };
        }),
      );
      return { workflows: summaries };
    });

    api.registerGatewayMethod("workflows.get", async (params) => {
      const id = String(params.id ?? "");
      if (!id) throw new Error("workflows.get: `id` is required");
      const store = storeFor(requireWorkspaceRoot("workflows.get"));
      const workflow = await store.getWorkflow(id);
      if (!workflow) throw new Error(`workflows.get: no workflow with id "${id}"`);
      return { workflow };
    });

    api.registerGatewayMethod("workflows.validate", async (params) => {
      const workflow = requireWorkflow(params.workflow, "workflows.validate");
      return { errors: validateWorkflow(workflow, KNOWN_NODE_TYPES) };
    });

    api.registerGatewayMethod("workflows.save", async (params) => {
      const workflow = requireWorkflow(params.workflow, "workflows.save");
      const errors = validateWorkflow(workflow, KNOWN_NODE_TYPES);
      if (errors.length > 0) {
        throw new Error(`workflows.save: workflow is invalid — ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
      }
      const store = storeFor(requireWorkspaceRoot("workflows.save"));
      await store.saveWorkflow(workflow);
      return { workflow };
    });

    api.registerGatewayMethod("workflows.delete", async (params) => {
      const id = String(params.id ?? "");
      if (!id) throw new Error("workflows.delete: `id` is required");
      const store = storeFor(requireWorkspaceRoot("workflows.delete"));
      await store.deleteWorkflow(id);
      return { ok: true };
    });

    api.registerGatewayMethod("workflows.setEnabled", async (params) => {
      const id = String(params.id ?? "");
      if (!id) throw new Error("workflows.setEnabled: `id` is required");
      const store = storeFor(requireWorkspaceRoot("workflows.setEnabled"));
      const workflow = await store.getWorkflow(id);
      if (!workflow) throw new Error(`workflows.setEnabled: no workflow with id "${id}"`);
      const updated: Workflow = { ...workflow, enabled: Boolean(params.enabled) };
      await store.saveWorkflow(updated);
      return { workflow: updated };
    });

    // The riskyNodes + graphHash a GrantDialog needs to render — recomputed
    // fresh from the stored workflow, not cached, so it always reflects the
    // exact thing granting would cover.
    api.registerGatewayMethod("workflows.grant.preview", async (params) => {
      const id = String(params.id ?? "");
      if (!id) throw new Error("workflows.grant.preview: `id` is required");
      const store = storeFor(requireWorkspaceRoot("workflows.grant.preview"));
      const workflow = await store.getWorkflow(id);
      if (!workflow) throw new Error(`workflows.grant.preview: no workflow with id "${id}"`);
      return { graphHash: computeGraphHash(workflow), riskyNodes: computeRiskyNodes(workflow) };
    });

    // Only the desktop app itself (a loopback WS connection) can grant a
    // workflow — workflows-design.md §6.2. Mobile and the MCP shim can save
    // workflows but never grant them.
    api.registerGatewayMethod("workflows.grant", async (params, ctx) => {
      const id = String(params.id ?? "");
      if (!id) throw new Error("workflows.grant: `id` is required");
      if (!isLoopbackConnection(ctx.connectionId)) {
        throw new Error("workflows.grant: only the desktop app (loopback) can grant a workflow");
      }
      const store = storeFor(requireWorkspaceRoot("workflows.grant"));
      const workflow = await store.getWorkflow(id);
      if (!workflow) throw new Error(`workflows.grant: no workflow with id "${id}"`);

      const graphHash = computeGraphHash(workflow);
      const requestedHash = String(params.graphHash ?? "");
      if (requestedHash !== graphHash) {
        throw new Error("workflows.grant: graphHash mismatch — the workflow changed since this was previewed, call workflows.grant.preview again before granting");
      }

      const grant: Grant = {
        workflowId: id,
        graphHash,
        riskyNodes: computeRiskyNodes(workflow),
        grantedAt: new Date().toISOString(),
        grantedBy: "desktop",
      };
      await store.saveGrant(grant);
      return { grant };
    });

    api.registerGatewayMethod("workflows.revokeGrant", async (params) => {
      const id = String(params.id ?? "");
      if (!id) throw new Error("workflows.revokeGrant: `id` is required");
      const store = storeFor(requireWorkspaceRoot("workflows.revokeGrant"));
      await store.deleteGrant(id);
      return { ok: true };
    });

    api.registerGatewayMethod("workflows.runs.list", async (params) => {
      const workflowId = typeof params.workflowId === "string" ? params.workflowId : undefined;
      const limit = typeof params.limit === "number" ? params.limit : undefined;
      const store = storeFor(requireWorkspaceRoot("workflows.runs.list"));
      return { runs: await store.listRuns(workflowId, limit) };
    });

    api.registerGatewayMethod("workflows.runs.get", async (params) => {
      const runId = String(params.runId ?? "");
      if (!runId) throw new Error("workflows.runs.get: `runId` is required");
      const store = storeFor(requireWorkspaceRoot("workflows.runs.get"));
      const run = await store.getRun(runId);
      if (!run) throw new Error(`workflows.runs.get: no run with id "${runId}"`);
      return { run };
    });

    // No node type produces a binary output yet (desktop.screenshot lands in
    // a later phase, see nodeTypes.ts) — this exists so the RPC surface
    // matches workflows-design.md §7.1 now, rather than needing a protocol
    // change once artifacts are real.
    api.registerGatewayMethod("workflows.artifacts.get", async () => {
      throw new Error("workflows.artifacts.get: no node type in this build produces artifacts yet");
    });

    api.registerGatewayMethod("workflows.cancel", async (params) => {
      const runId = String(params.runId ?? "");
      const controller = activeRuns.get(runId);
      if (!controller) return { ok: false, reason: "no in-flight run with that id" };
      controller.abort();
      return { ok: true };
    });

    api.registerGatewayMethod("workflows.run", async (params, ctx) => {
      const id = String(params.id ?? "");
      if (!id) throw new Error("workflows.run: `id` is required");
      const store = storeFor(requireWorkspaceRoot("workflows.run"));
      const workflow = await store.getWorkflow(id);
      if (!workflow) throw new Error(`workflows.run: no workflow with id "${id}"`);

      // Same call, two trigger identities (workflows-design.md §7.1): the
      // desktop app's own loopback connection is always "manual"; anything
      // else (the phone, a LAN client) is "mobile" and needs
      // allowRemoteTrigger — same posture as the webhook route, just without
      // a per-trigger secret since the WS connection is already authed.
      const isRemote = !isLoopbackConnection(ctx.connectionId);
      if (isRemote && !workflow.settings.allowRemoteTrigger) {
        return { run: null, skipped: true, reason: "remote_trigger_denied" };
      }
      const trigger = isRemote ? ({ id: "mobile", type: "mobile" as const, payload: params.input }) : ({ id: "manual", type: "manual" as const, payload: params.input });

      const result = await executeWorkflowRun({
        workflow,
        trigger,
        store,
        events: ctx.events,
      });
      if (!result.ok) {
        if (result.reason === "invalid_workflow") {
          throw new Error(`workflows.run: stored workflow is invalid — ${result.message}`);
        }
        return { run: null, skipped: true, reason: result.reason };
      }
      return { run: result.run };
    });

    // Remote trigger surface for `webhook` triggers — see
    // notes/automation/workflows-design.md §7.3. The actual HTTP route lives
    // in packages/gateway/src/server.ts (POST|GET /hooks/workflows/:id),
    // which dispatches here through the normal gateway-method RPC path
    // rather than importing anything from this package, keeping the gateway
    // package free of any workflows-specific type dependency.
    api.registerGatewayMethod("workflows.runWebhook", async (params, ctx) => {
      const id = String(params.id ?? "");
      if (!id) throw new Error("workflows.runWebhook: `id` is required");
      const store = storeFor(requireWorkspaceRoot("workflows.runWebhook"));
      const workflow = await store.getWorkflow(id);
      if (!workflow) return { ok: false, status: 404, reason: "not_found" };
      if (!workflow.enabled) return { ok: false, status: 403, reason: "workflow_disabled" };
      if (!workflow.settings.allowRemoteTrigger) return { ok: false, status: 403, reason: "remote_trigger_denied" };

      const method = typeof params.method === "string" ? params.method : "POST";
      const trigger = workflow.triggers.find((t): t is Extract<Workflow["triggers"][number], { type: "webhook" }> => t.type === "webhook" && t.method === method);
      if (!trigger) return { ok: false, status: 404, reason: "no_matching_webhook_trigger" };

      const auth = verifyWebhookAuth({
        secretRef: trigger.secretRef,
        bearerToken: typeof params.bearerToken === "string" ? params.bearerToken : undefined,
        signatureHex: typeof params.signatureHex === "string" ? params.signatureHex : undefined,
        rawBody: typeof params.rawBody === "string" ? params.rawBody : undefined,
      });
      if (!auth.ok) return { ok: false, status: auth.reason === "misconfigured" ? 500 : 401, reason: auth.reason };

      const result = await executeWorkflowRun({ workflow, trigger: { id: trigger.id, type: "webhook", payload: params.payload }, store, events: ctx.events });
      if (!result.ok) {
        if (result.reason === "invalid_workflow") return { ok: false, status: 400, reason: "invalid_workflow", message: result.message };
        return { ok: false, status: 409, reason: result.reason };
      }
      return { ok: true, status: 200, run: result.run };
    });

    // Ticks the scheduler and subscribes the event triggers for as long as
    // this gateway process is up — workflows-design.md §10.1 phase 4 scope
    // is "runs only while the project window is open" (v1), same posture as
    // extensions/service-cron.
    let scheduler: Scheduler | undefined;
    let unsubscribeEventTriggers: (() => void) | undefined;
    api.registerService({
      id: "service-workflows",
      start(ctx) {
        const workspaceRoot = getKernelContext()?.workspaceRoot;
        if (!workspaceRoot) {
          ctx.logger.warn("service-workflows: no workspaceRoot at service start — scheduler and event triggers are disabled for this run");
          return;
        }
        const store = storeFor(workspaceRoot);
        scheduler = new Scheduler(store, api.events, ctx.logger);
        scheduler.start();
        unsubscribeEventTriggers = registerEventTriggers({ events: api.events, store, logger: ctx.logger });
      },
      stop() {
        scheduler?.stop();
        scheduler = undefined;
        unsubscribeEventTriggers?.();
        unsubscribeEventTriggers = undefined;
      },
    });
  },
});

export default plugin;
