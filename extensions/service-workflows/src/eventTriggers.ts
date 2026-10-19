import { evaluateCondition } from "@yggdrasil/workflows";
import type { EventBus, PluginLogger } from "@yggdrasil/sdk";
import type { Trigger } from "@yggdrasil/workflows";
import type { WorkflowStore } from "./store.js";
import { executeWorkflowRun } from "./run.js";

/** The fixed set of event names a workflow's `event` trigger can subscribe to — see types.ts's Trigger union. */
const WATCHED_EVENTS = ["fs.changed", "workflow.run.finished", "turn.completed"] as const;

/**
 * Subscribes once per watched event name; on each firing, re-reads the
 * workflow list from the store (cheap at v1's scale) so a workflow
 * saved/deleted while the gateway is running is picked up without needing to
 * resubscribe. Returns an unsubscribe function for the service's stop().
 */
export function registerEventTriggers(params: { events: EventBus; store: WorkflowStore; logger: PluginLogger }): () => void {
  const { events, store, logger } = params;

  const unsubscribers = WATCHED_EVENTS.map((eventName) =>
    events.on(eventName, (payload) => {
      void handleEvent(eventName, payload).catch((err) => logger.error(`service-workflows: event trigger handling for "${eventName}" failed: ${String(err)}`));
    }),
  );

  async function handleEvent(eventName: (typeof WATCHED_EVENTS)[number], payload: unknown): Promise<void> {
    const workflows = await store.listWorkflows();
    for (const workflow of workflows) {
      if (!workflow.enabled) continue;
      for (const trigger of workflow.triggers) {
        if (trigger.type !== "event" || trigger.event !== eventName) continue;

        // A workflow reacting to its own run finishing is the obvious
        // self-trigger footgun for this event in particular — guard it here
        // rather than relying on every workflow author to remember to.
        if (eventName === "workflow.run.finished" && isSameWorkflowPayload(payload, workflow.id)) continue;

        if (trigger.filter && !matchesFilter(trigger.filter, payload)) continue;

        const result = await executeWorkflowRun({
          workflow,
          trigger: { id: trigger.id, type: "event", payload },
          store,
          events,
        });
        if (!result.ok) {
          logger.info(`service-workflows: event trigger for "${workflow.id}" did not run (${result.reason})`);
        }
      }
    }
  }

  return () => {
    for (const unsub of unsubscribers) unsub();
  };
}

function isSameWorkflowPayload(payload: unknown, workflowId: string): boolean {
  return !!payload && typeof payload === "object" && (payload as { workflowId?: unknown }).workflowId === workflowId;
}

function matchesFilter(filter: Extract<Trigger, { type: "event" }>["filter"], payload: unknown): boolean {
  if (!filter) return true;
  return evaluateCondition(filter, { nodes: {}, trigger: payload, vars: {}, run: { id: "" } });
}
