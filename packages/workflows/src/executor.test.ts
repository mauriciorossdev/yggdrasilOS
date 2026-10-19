import { describe, it, expect } from "vitest";
import { runWorkflow, type NodeExecutor, type ExecutorEvent } from "./executor.js";
import { logicNodeExecutors } from "./nodes/logic.js";
import type { Workflow, WfNode } from "./types.js";

const SETTINGS: Workflow["settings"] = {
  concurrency: "skip",
  timeoutMs: 600_000,
  allowRemoteTrigger: false,
  misfire: "skip",
  misfireGraceMs: 900_000,
};

function node(partial: Partial<WfNode> & Pick<WfNode, "id" | "type">): WfNode {
  return { name: partial.id, position: { x: 0, y: 0 }, params: {}, ...partial };
}

function trigger(): { id: string; type: "manual" } {
  return { id: "t1", type: "manual" };
}

describe("runWorkflow — ordering and basic execution", () => {
  it("runs a linear chain in order and threads outputs through expressions", async () => {
    const order: string[] = [];
    const echo: NodeExecutor = async ({ node: n, params }) => {
      order.push(n.id);
      return { handle: "out", output: params };
    };

    const workflow: Workflow = {
      id: "wf1",
      name: "chain",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [
        node({ id: "a", type: "echo", params: { value: "hi" } }),
        node({ id: "b", type: "echo", params: { value: "{{ nodes.a.output.value }} world" } }),
      ],
      edges: [{ id: "e1", from: "a", fromHandle: "out", to: "b" }],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { echo } });

    expect(order).toEqual(["a", "b"]);
    expect(run.status).toBe("succeeded");
    expect(run.nodes.a?.status).toBe("succeeded");
    expect(run.nodes.b?.status).toBe("succeeded");
    expect(run.nodes.b?.output).toEqual({ value: "hi world" });
  });

  it("runs independent branches in parallel (both roots start before either finishes)", async () => {
    let concurrentPeak = 0;
    let inFlight = 0;
    const slow: NodeExecutor = async () => {
      inFlight++;
      concurrentPeak = Math.max(concurrentPeak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { handle: "out" };
    };

    const workflow: Workflow = {
      id: "wf2",
      name: "parallel",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "a", type: "slow" }), node({ id: "b", type: "slow" }), node({ id: "c", type: "slow" })],
      edges: [],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { slow } });
    expect(run.status).toBe("succeeded");
    expect(concurrentPeak).toBeGreaterThan(1);
  });

  it("caps concurrency at maxParallel", async () => {
    let concurrentPeak = 0;
    let inFlight = 0;
    const slow: NodeExecutor = async () => {
      inFlight++;
      concurrentPeak = Math.max(concurrentPeak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return { handle: "out" };
    };

    const nodes = Array.from({ length: 6 }, (_, i) => node({ id: `n${i}`, type: "slow" }));
    const workflow: Workflow = {
      id: "wf3",
      name: "cap",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes,
      edges: [],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { slow }, maxParallel: 2 });
    expect(run.status).toBe("succeeded");
    expect(concurrentPeak).toBeLessThanOrEqual(2);
  });
});

describe("runWorkflow — branching and skip propagation", () => {
  it("takes the true branch and skips the false branch's node", async () => {
    const ran: string[] = [];
    const track = (id: string): NodeExecutor => async () => {
      ran.push(id);
      return { handle: "out" };
    };

    const workflow: Workflow = {
      id: "wf4",
      name: "branch",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [
        node({ id: "cond", type: "if", params: { condition: { op: "eq", left: "vars.flag", right: true } } }),
        node({ id: "onTrue", type: "onTrue" }),
        node({ id: "onFalse", type: "onFalse" }),
      ],
      edges: [
        { id: "e1", from: "cond", fromHandle: "true", to: "onTrue" },
        { id: "e2", from: "cond", fromHandle: "false", to: "onFalse" },
      ],
    };

    const run = await runWorkflow({
      workflow,
      trigger: trigger(),
      vars: { flag: true },
      nodeExecutors: { if: logicNodeExecutors.if!, onTrue: track("onTrue"), onFalse: track("onFalse") },
    });

    expect(ran).toEqual(["onTrue"]);
    expect(run.nodes.onTrue?.status).toBe("succeeded");
    expect(run.nodes.onFalse?.status).toBe("skipped");
    expect(run.status).toBe("succeeded");
  });

  it("propagates skip transitively through a chain hanging off the untaken branch", async () => {
    const ran: string[] = [];
    const track = (id: string): NodeExecutor => async () => {
      ran.push(id);
      return { handle: "out" };
    };

    const workflow: Workflow = {
      id: "wf5",
      name: "transitive-skip",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [
        node({ id: "cond", type: "if", params: { condition: { op: "eq", left: "vars.flag", right: false } } }),
        node({ id: "a", type: "a" }),
        node({ id: "b", type: "b" }), // hangs off "a", never reached
      ],
      edges: [
        { id: "e1", from: "cond", fromHandle: "true", to: "a" },
        { id: "e2", from: "a", fromHandle: "out", to: "b" },
      ],
    };

    const run = await runWorkflow({
      workflow,
      trigger: trigger(),
      vars: { flag: true }, // condition is false -> "true" branch never activates
      nodeExecutors: { if: logicNodeExecutors.if!, a: track("a"), b: track("b") },
    });

    expect(ran).toEqual([]);
    expect(run.nodes.a?.status).toBe("skipped");
    expect(run.nodes.b?.status).toBe("skipped");
  });
});

describe("runWorkflow — retries, timeouts, onError", () => {
  it("retries a failing node up to `retry.max` times, then succeeds if it recovers", async () => {
    let attempts = 0;
    const flaky: NodeExecutor = async () => {
      attempts++;
      if (attempts < 3) throw new Error("transient");
      return { handle: "out", output: { attempts } };
    };

    const workflow: Workflow = {
      id: "wf6",
      name: "retry",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "a", type: "flaky", retry: { max: 3, backoffMs: 1 } })],
      edges: [],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { flaky } });
    expect(run.status).toBe("succeeded");
    expect(run.nodes.a?.attempts).toBe(3);
    expect(run.nodes.a?.output).toEqual({ attempts: 3 });
  });

  it("fails the run when a node with onError=fail exhausts its retries", async () => {
    const alwaysFails: NodeExecutor = async () => {
      throw new Error("permanent failure");
    };

    const workflow: Workflow = {
      id: "wf7",
      name: "fail",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "a", type: "bad", retry: { max: 1, backoffMs: 1 } })],
      edges: [],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { bad: alwaysFails } });
    expect(run.status).toBe("failed");
    expect(run.nodes.a?.status).toBe("failed");
    expect(run.error?.nodeId).toBe("a");
    expect(run.error?.message).toContain("permanent failure");
  });

  it("onError=continue keeps the run going through the `out` handle with the error as output", async () => {
    const alwaysFails: NodeExecutor = async () => {
      throw new Error("boom");
    };
    const ran: string[] = [];
    const next: NodeExecutor = async () => {
      ran.push("next");
      return { handle: "out" };
    };

    const workflow: Workflow = {
      id: "wf8",
      name: "continue",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "a", type: "bad", onError: "continue" }), node({ id: "b", type: "next" })],
      edges: [{ id: "e1", from: "a", fromHandle: "out", to: "b" }],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { bad: alwaysFails, next } });
    expect(ran).toEqual(["next"]);
    expect(run.nodes.a?.status).toBe("failed");
    expect(run.nodes.b?.status).toBe("succeeded");
    expect(run.status).toBe("succeeded"); // the run itself isn't fatally failed
  });

  it("onError=errorBranch routes through the `error` handle", async () => {
    const alwaysFails: NodeExecutor = async () => {
      throw new Error("boom");
    };
    const ran: string[] = [];
    const onOk: NodeExecutor = async () => {
      ran.push("ok");
      return { handle: "out" };
    };
    const onErr: NodeExecutor = async () => {
      ran.push("err");
      return { handle: "out" };
    };

    const workflow: Workflow = {
      id: "wf9",
      name: "error-branch",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "a", type: "bad", onError: "errorBranch" }), node({ id: "ok", type: "ok" }), node({ id: "err", type: "err" })],
      edges: [
        { id: "e1", from: "a", fromHandle: "out", to: "ok" },
        { id: "e2", from: "a", fromHandle: "error", to: "err" },
      ],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { bad: alwaysFails, ok: onOk, err: onErr } });
    expect(ran).toEqual(["err"]);
    expect(run.nodes.ok?.status).toBe("skipped");
    expect(run.nodes.err?.status).toBe("succeeded");
  });

  it("times out a node that never resolves and fails the run", async () => {
    const hangs: NodeExecutor = () => new Promise(() => {}); // never resolves

    const workflow: Workflow = {
      id: "wf10",
      name: "timeout",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "a", type: "hangs", timeoutMs: 20 })],
      edges: [],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { hangs } });
    expect(run.status).toBe("failed");
    expect(run.nodes.a?.status).toBe("failed");
  });
});

describe("runWorkflow — cancellation", () => {
  it("stops scheduling new nodes and marks the run cancelled when the signal aborts mid-run", async () => {
    const controller = new AbortController();
    const started: string[] = [];

    const slow: NodeExecutor = async ({ signal }) => {
      started.push("a");
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 200);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        });
      });
      return { handle: "out" };
    };
    const never: NodeExecutor = async () => {
      started.push("b"); // should never run — b only starts after a finishes
      return { handle: "out" };
    };

    const workflow: Workflow = {
      id: "wf11",
      name: "cancel",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "a", type: "slow" }), node({ id: "b", type: "never" })],
      edges: [{ id: "e1", from: "a", fromHandle: "out", to: "b" }],
    };

    const runPromise = runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { slow, never }, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    const run = await runPromise;

    expect(started).toEqual(["a"]);
    expect(run.status).toBe("cancelled");
  });
});

describe("runWorkflow — events", () => {
  it("emits run.started, per-node started/finished, and run.finished in order", async () => {
    const events: ExecutorEvent["type"][] = [];
    const echo: NodeExecutor = async () => ({ handle: "out" });

    const workflow: Workflow = {
      id: "wf12",
      name: "events",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "a", type: "echo" })],
      edges: [],
    };

    await runWorkflow({
      workflow,
      trigger: trigger(),
      nodeExecutors: { echo },
      onEvent: (e) => events.push(e.type),
    });

    expect(events).toEqual(["run.started", "node.started", "node.finished", "run.finished"]);
  });
});
