import { decideScheduleTick } from "@yggdrasil/workflows";
import type { EventBus, PluginLogger } from "@yggdrasil/sdk";
import type { WorkflowStore } from "./store.js";
import { executeWorkflowRun } from "./run.js";

const DEFAULT_TICK_MS = 30_000;

function triggerKey(workflowId: string, triggerId: string): string {
  return `${workflowId}:${triggerId}`;
}

/**
 * Ticks every 30s (workflows-design.md §5.11) and, for each enabled
 * `schedule` trigger, asks the pure decideScheduleTick whether it's due —
 * using our own persisted lastFiredAt/lastCheckedAt rather than node-cron's
 * in-process callbacks, which don't survive the Mac sleeping or the gateway
 * restarting. `tick()` is exposed directly (not just via start()/setInterval)
 * so tests can drive it with a fake clock instead of real timers.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly store: WorkflowStore,
    private readonly events: EventBus,
    private readonly logger: PluginLogger,
    private readonly tickMs: number = DEFAULT_TICK_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick(new Date()).catch((err) => this.logger.error(`service-workflows scheduler tick failed: ${String(err)}`));
    }, this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now: Date): Promise<void> {
    const state = await this.store.getSchedulerState();
    const lastCheckedAt = state.lastCheckedAt ? new Date(state.lastCheckedAt) : undefined;
    const workflows = await this.store.listWorkflows();

    for (const workflow of workflows) {
      if (!workflow.enabled) continue;
      for (const trigger of workflow.triggers) {
        if (trigger.type !== "schedule") continue;
        const key = triggerKey(workflow.id, trigger.id);
        // The first tick that ever sees this trigger anchors the baseline at
        // "now" and persists it immediately, even though nothing fires yet —
        // recomputing "now" fresh on every still-idle tick would mean
        // computeNextFire's next-occurrence-after-baseline could never equal
        // a later tick's own "now" (it's always strictly in the future
        // relative to whatever baseline that tick just made up), so the
        // trigger would never become due at all.
        const isFirstSeen = !(key in state.lastFiredAt);
        const baselineAt = isFirstSeen ? now : new Date(state.lastFiredAt[key]!);

        const decision = decideScheduleTick({
          cron: trigger.cron,
          timezone: trigger.timezone,
          baselineAt,
          lastCheckedAt,
          now,
          misfire: workflow.settings.misfire,
          misfireGraceMs: workflow.settings.misfireGraceMs,
        });

        if (decision.action === "none") {
          if (isFirstSeen) state.lastFiredAt[key] = now.toISOString();
          continue;
        }
        state.lastFiredAt[key] = decision.firedAt.toISOString();

        if (decision.action === "skip-misfire") {
          this.logger.warn(`service-workflows: skipped a missed schedule fire for "${workflow.id}" (trigger "${trigger.id}") — past misfireGraceMs`);
          continue;
        }

        const result = await executeWorkflowRun({
          workflow,
          trigger: { id: trigger.id, type: "schedule" },
          store: this.store,
          events: this.events,
        });
        if (!result.ok) {
          this.logger.info(`service-workflows: schedule trigger for "${workflow.id}" did not run (${result.reason})`);
        }
      }
    }

    state.lastCheckedAt = now.toISOString();
    await this.store.saveSchedulerState(state);
  }
}
