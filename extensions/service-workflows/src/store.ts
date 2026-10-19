import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Grant, Run, Workflow } from "@yggdrasil/workflows";

/** Persisted scheduler bookkeeping — see schedule.ts's decideScheduleTick and scheduler.ts. */
export type SchedulerState = {
  /** Last time the scheduler ticked at all, ISO — used to tell "continuous operation" apart from "the process was asleep/down". */
  lastCheckedAt?: string;
  /** `${workflowId}:${triggerId}` -> ISO instant of the last occurrence this trigger fired (or consumed as a misfire). */
  lastFiredAt: Record<string, string>;
};

/**
 * Plain-JSON filesystem store — no database. Definitions and run state live
 * in separate roots on purpose (workflows-design.md §2.4): definitions are
 * meant to be committed to the project repo (`<project>/.yggdrasil/workflows/`),
 * runs/state are always local-only (`userData/workflows/<projectId>/` when
 * the desktop app sets YGGDRASIL_WORKFLOW_STATE_DIR — see index.ts).
 */
export class WorkflowStore {
  constructor(
    private readonly definitionsDir: string,
    private readonly stateDir: string,
  ) {}

  private runsDir(): string {
    return join(this.stateDir, "runs");
  }

  private grantsDir(): string {
    return join(this.stateDir, "grants");
  }

  async getGrant(workflowId: string): Promise<Grant | undefined> {
    return this.readJson<Grant>(join(this.grantsDir(), `${workflowId}.json`));
  }

  async saveGrant(grant: Grant): Promise<void> {
    await mkdir(this.grantsDir(), { recursive: true });
    await writeFile(join(this.grantsDir(), `${grant.workflowId}.json`), JSON.stringify(grant, null, 2), "utf8");
  }

  async deleteGrant(workflowId: string): Promise<void> {
    await rm(join(this.grantsDir(), `${workflowId}.json`), { force: true });
  }

  private schedulerStatePath(): string {
    return join(this.stateDir, "scheduler-state.json");
  }

  async getSchedulerState(): Promise<SchedulerState> {
    return (await this.readJson<SchedulerState>(this.schedulerStatePath())) ?? { lastFiredAt: {} };
  }

  async saveSchedulerState(state: SchedulerState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    await writeFile(this.schedulerStatePath(), JSON.stringify(state, null, 2), "utf8");
  }

  async listWorkflows(): Promise<Workflow[]> {
    const files = await this.listJsonFiles(this.definitionsDir);
    const workflows: Workflow[] = [];
    for (const file of files) {
      const wf = await this.readJson<Workflow>(join(this.definitionsDir, file));
      if (wf) workflows.push(wf);
    }
    return workflows;
  }

  async getWorkflow(id: string): Promise<Workflow | undefined> {
    return this.readJson<Workflow>(join(this.definitionsDir, `${id}.json`));
  }

  async saveWorkflow(workflow: Workflow): Promise<void> {
    await mkdir(this.definitionsDir, { recursive: true });
    await writeFile(join(this.definitionsDir, `${workflow.id}.json`), JSON.stringify(workflow, null, 2), "utf8");
  }

  async deleteWorkflow(id: string): Promise<void> {
    await rm(join(this.definitionsDir, `${id}.json`), { force: true });
    await this.deleteGrant(id);
  }

  async saveRun(run: Run): Promise<void> {
    await mkdir(this.runsDir(), { recursive: true });
    await writeFile(join(this.runsDir(), `${run.id}.json`), JSON.stringify(run, null, 2), "utf8");
  }

  async getRun(id: string): Promise<Run | undefined> {
    return this.readJson<Run>(join(this.runsDir(), `${id}.json`));
  }

  async listRuns(workflowId?: string, limit = 50): Promise<Run[]> {
    const files = await this.listJsonFiles(this.runsDir());
    const runs: Run[] = [];
    for (const file of files) {
      const run = await this.readJson<Run>(join(this.runsDir(), file));
      if (run && (!workflowId || run.workflowId === workflowId)) runs.push(run);
    }
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return runs.slice(0, limit);
  }

  private async listJsonFiles(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir);
      return entries.filter((e) => e.endsWith(".json"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }
}
