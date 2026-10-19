import { definePlugin } from "@yggdrasil/sdk";
import type { YggdrasilConfig } from "@yggdrasil/config";
import { getKernelContext } from "@yggdrasil/kernel";
import { ingestInboundMessage, runChannelTurn } from "@yggdrasil/pipeline";
import cron from "node-cron";

export type CronJob = {
  id: string;
  expression: string;
  message: string;
  sessionKey: string;
  timezone?: string;
  enabled?: boolean;
};

type CronPluginConfig = {
  jobs?: CronJob[];
};

const tasks: cron.ScheduledTask[] = [];

const plugin = definePlugin({
  id: "service-cron",
  name: "Cron Scheduler",
  version: "0.1.0",
  register(api) {
    api.registerService({
      id: "service-cron",
      async start(ctx) {
        const fullConfig = ctx.config as YggdrasilConfig;
        const pluginCfg = (fullConfig.pluginConfig?.["service-cron"] ?? {}) as CronPluginConfig;
        const jobs = pluginCfg.jobs ?? [];

        if (jobs.length === 0) {
          ctx.logger.info("service-cron: no jobs configured");
          return;
        }

        for (const job of jobs) {
          if (job.enabled === false) continue;

          if (!cron.validate(job.expression)) {
            ctx.logger.error(`service-cron: invalid cron expression for job "${job.id}": ${job.expression}`);
            continue;
          }

          const task = cron.schedule(
            job.expression,
            async () => {
              const kernelCtx = getKernelContext();
              const [channelId, accountId, ...rest] = job.sessionKey.split(":");
              const senderId = rest.join(":") || "cron";

              const inbound = ingestInboundMessage({
                channelId: channelId ?? "cron",
                accountId: accountId ?? "default",
                sessionKey: job.sessionKey,
                senderId,
                body: job.message,
                metadata: { source: "cron", jobId: job.id },
                timestamp: Date.now(),
              });

              try {
                await runChannelTurn({
                  message: inbound,
                  config: fullConfig,
                  workspaceRoot: kernelCtx?.workspaceRoot,
                });
              } catch (err) {
                ctx.logger.error(`service-cron: job "${job.id}" failed: ${String(err)}`);
              }
            },
            {
              timezone: job.timezone,
            },
          );

          tasks.push(task);
          ctx.logger.info(`service-cron: scheduled job "${job.id}" [${job.expression}]`);
        }
      },
      async stop() {
        for (const task of tasks) {
          task.stop();
        }
        tasks.length = 0;
      },
    });
  },
});

export default plugin;
