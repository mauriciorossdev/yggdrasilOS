import { describe, expect, it } from "vitest";
import type { ChatCompleteParams, ChatCompleteResult, ProviderPlugin } from "@yggdrasil/sdk";
import { runToolLoop, type GuardKind, type ToolLoopOptions } from "./tool-loop.js";

const TOOL = {
  type: "function" as const,
  function: { name: "run", description: "run", parameters: { type: "object" as const, properties: {} } },
};

const call = (args: Record<string, unknown> = {}, id = "c"): ChatCompleteResult => ({
  text: "",
  model: "m",
  finishReason: "tool_calls",
  toolCalls: [{ id, name: "run", arguments: JSON.stringify(args) }],
});
const say = (text: string): ChatCompleteResult => ({ text, model: "m", finishReason: "stop" });

/** A provider that plays back scripted replies and remembers what it was asked. */
function scripted(replies: ChatCompleteResult[]) {
  const seen: ChatCompleteParams[] = [];
  let i = 0;
  const provider: ProviderPlugin = {
    id: "p",
    label: "P",
    listModels: () => [],
    chatComplete: async (_ctx, params) => {
      seen.push(params);
      return replies[Math.min(i++, replies.length - 1)]!;
    },
  };
  return { provider, seen };
}

function options(provider: ProviderPlugin, over: Partial<ToolLoopOptions> = {}) {
  const guardEvents: GuardKind[] = [];
  const executed: Array<Record<string, unknown>> = [];
  const opts: ToolLoopOptions = {
    provider,
    providerCfg: {},
    model: "m",
    sessionKey: "s",
    messages: [{ role: "user", content: "go" }],
    tools: [TOOL],
    maxIterations: 8,
    streaming: false,
    executeTool: async (_name, args) => {
      executed.push(args);
      return { ok: true };
    },
    onGuard: (e) => guardEvents.push(e.kind),
    ...over,
  };
  return { opts, guardEvents, executed };
}

const nudgesIn = (messages: ChatCompleteParams["messages"]) => messages.filter((m) => m.role === "user" && typeof m.content === "string" && /^(Your last reply|You said you would|You have reached|You keep repeating)/.test(m.content));

describe("empty reply guard", () => {
  it("retries and does not store the nudge", async () => {
    const { provider, seen } = scripted([say(""), say("here is the answer")]);
    const { opts, guardEvents } = options(provider);
    const result = await runToolLoop(opts);
    expect(result.text).toBe("here is the answer");
    expect(guardEvents).toEqual(["empty-retry"]);
    expect(nudgesIn(seen[1]!.messages)).toHaveLength(1);
    expect(JSON.stringify(result.sessionAppend)).not.toContain("Your last reply was empty");
  });

  it("keeps retrying up to the limit, then gives up", async () => {
    const empties = (n: number) => Array.from({ length: n }, () => say(""));

    const rescued = options(scripted([...empties(10), say("finally an answer")]).provider);
    expect((await runToolLoop(rescued.opts)).text).toBe("finally an answer");
    expect(rescued.guardEvents).toHaveLength(10);

    const hopeless = options(scripted([...empties(11), say("never reached")]).provider);
    expect((await runToolLoop(hopeless.opts)).text).toBe("(the model returned an empty response)");
    expect(hopeless.guardEvents).toHaveLength(10);
  });

  it("does not spend the turn's tool iterations on retries", async () => {
    // 3 empties then a tool call then an answer, with only 2 iterations allowed: the retries must not count.
    const { provider } = scripted([say(""), say(""), say(""), call({ n: 1 }, "1"), say("done")]);
    const { opts, executed } = options(provider, { maxIterations: 2 });
    const result = await runToolLoop(opts);
    expect(executed).toHaveLength(1);
    expect(result.text).toBe("done");
  });
});

describe("announced-action guard", () => {
  it("pushes a model that says it will act, then lets it act and finish", async () => {
    const { provider, seen } = scripted([say("Voy a ejecutar el comando para borrar los temporales:"), call(), say("Listo, borré los temporales.")]);
    const { opts, guardEvents, executed } = options(provider);
    const result = await runToolLoop(opts);
    expect(guardEvents).toEqual(["action-nudge"]);
    expect(executed).toHaveLength(1);
    expect(result.text).toBe("Listo, borré los temporales.");
    expect(nudgesIn(seen[1]!.messages)).toHaveLength(1);
    // What it said is kept; the nudge is not.
    const stored = JSON.stringify(result.sessionAppend);
    expect(stored).toContain("Voy a ejecutar el comando");
    expect(stored).not.toContain("You said you would");
  });

  it("nudges at most twice, then accepts the reply", async () => {
    const { provider } = scripted([say("Voy a hacerlo:"), say("Voy a hacerlo ahora:"), say("Voy a intentarlo:"), say("unused")]);
    const { opts, guardEvents } = options(provider);
    const result = await runToolLoop(opts);
    expect(guardEvents).toEqual(["action-nudge", "action-nudge"]);
    expect(result.text).toBe("Voy a intentarlo:");
  });

  it("leaves a plain answer and tool-less runs alone", async () => {
    const plain = options(scripted([say("El puerto es 48213.")]).provider);
    expect((await runToolLoop(plain.opts)).text).toBe("El puerto es 48213.");
    expect(plain.guardEvents).toEqual([]);

    const noTools = options(scripted([say("I will explain:")]).provider, { tools: [] });
    expect((await runToolLoop(noTools.opts)).text).toBe("I will explain:");
    expect(noTools.guardEvents).toEqual([]);
  });
});

describe("repeated-call guard", () => {
  it("refuses the fourth identical call and tells the model why", async () => {
    const same = { command: "npm test" };
    const { provider } = scripted([call(same, "1"), call(same, "2"), call(same, "3"), call(same, "4"), say("ok, trying something else")]);
    const { opts, guardEvents, executed } = options(provider);
    const result = await runToolLoop(opts);
    expect(executed).toHaveLength(3);
    expect(guardEvents).toEqual(["repeat-refused"]);
    const refusal = result.sessionAppend?.find((m) => m.role === "tool" && m.tool_call_id === "4");
    expect(refusal?.content).toContain("already called run with exactly these arguments 3 times");
    expect(result.text).toBe("ok, trying something else");
  });

  it("a different call in between resets the count", async () => {
    const { provider } = scripted([call({ a: 1 }, "1"), call({ a: 1 }, "2"), call({ a: 2 }, "3"), call({ a: 1 }, "4"), call({ a: 1 }, "5"), say("done")]);
    const { opts, guardEvents, executed } = options(provider);
    await runToolLoop(opts);
    expect(executed).toHaveLength(5);
    expect(guardEvents).toEqual([]);
  });

  it("stops and summarizes when the model keeps insisting", async () => {
    const same = { command: "x" };
    // 3 run, then 3 refused (past the limit of 2 refusals) → the next model call is the summary.
    const replies = [1, 2, 3, 4, 5, 6].map((n) => call(same, String(n)));
    const { provider, seen } = scripted([...replies, say("I was stuck retrying the same command.")]);
    const { opts, guardEvents } = options(provider, { maxIterations: 20 });
    const result = await runToolLoop(opts);
    expect(guardEvents).toContain("stuck-summary");
    expect(result.classification).toBe("error");
    expect(result.text).toContain("I was stuck retrying the same command.");
    expect(result.text).toContain("kept repeating the same tool call");
    // The summary call carries no tools.
    expect(seen.at(-1)!.tools).toBeUndefined();
  });
});

describe("iteration limit", () => {
  it("asks for a summary instead of returning a bare error", async () => {
    const { provider, seen } = scripted([call({ n: 1 }, "1"), call({ n: 2 }, "2"), say("I wrote two files; the tests are still missing.")]);
    const { opts, guardEvents } = options(provider, { maxIterations: 2 });
    const result = await runToolLoop(opts);
    expect(guardEvents).toEqual(["limit-summary"]);
    expect(result.classification).toBe("error");
    expect(result.text).toContain("I wrote two files; the tests are still missing.");
    expect(result.text).toContain("Tool loop exceeded maximum iterations");
    expect(seen.at(-1)!.tools).toBeUndefined();
    expect(JSON.stringify(result.sessionAppend)).not.toContain("You have reached the limit");
  });

  it("falls back to the plain message when the summary comes back empty", async () => {
    const { provider } = scripted([call({ n: 1 }, "1"), say("")]);
    const result = await runToolLoop(options(provider, { maxIterations: 1 }).opts);
    expect(result.text).toBe("Tool loop exceeded maximum iterations.");
  });
});

describe("guards: false", () => {
  it("restores the bare loop", async () => {
    const empty = await runToolLoop(options(scripted([say("")]).provider, { guards: false }).opts);
    expect(empty.text).toBe("(the model returned an empty response)");

    const limited = options(scripted([call({ n: 1 }, "1"), call({ n: 2 }, "2")]).provider, { guards: false, maxIterations: 2 });
    const result = await runToolLoop(limited.opts);
    expect(result.text).toBe("Tool loop exceeded maximum iterations.");
    expect(limited.guardEvents).toEqual(["limit-summary"]); // still reported, just without the extra model call
  });

  it("does not refuse repeats", async () => {
    const same = { command: "x" };
    const { opts, executed } = options(scripted([call(same, "1"), call(same, "2"), call(same, "3"), call(same, "4"), call(same, "5"), say("done")]).provider, { guards: false });
    await runToolLoop(opts);
    expect(executed).toHaveLength(5);
  });
});

describe("provider retries", () => {
  it("passes the provider's retry notices on to onProviderRetry", async () => {
    const seen: Array<{ attempt: number; reason: string }> = [];
    const provider: ProviderPlugin = {
      id: "p",
      label: "P",
      listModels: () => [],
      chatComplete: async (_ctx, params) => {
        params.onRetry?.({ attempt: 1, delayMs: 1000, reason: "HTTP 503" });
        return say("ok");
      },
    };
    const { opts } = options(provider, { onProviderRetry: (i) => seen.push({ attempt: i.attempt, reason: i.reason }) });
    expect((await runToolLoop(opts)).text).toBe("ok");
    expect(seen).toEqual([{ attempt: 1, reason: "HTTP 503" }]);
  });
});
