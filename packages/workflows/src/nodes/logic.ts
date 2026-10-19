import type { NodeExecutor } from "../executor.js";
import { evaluateCondition } from "../conditions.js";
import { loopExecutor } from "./loop.js";
import type { Condition } from "../types.js";

/** `params.condition` — a `Condition` object, already free of `{{ }}` template strings (resolveParams only touches string leaves, and Condition.left/right are meant to be raw paths/literals per workflows-design.md §3, not expressions). Fires "true" or "false". */
export const ifExecutor: NodeExecutor = async ({ params, exprCtx }) => {
  const condition = params.condition as Condition | undefined;
  if (!condition) throw new Error("if node requires a `condition` param");
  const matched = evaluateCondition(condition, exprCtx);
  return { handle: matched ? "true" : "false", output: { matched } };
};

/** `params.name` + `params.value` (value may contain `{{ }}`, already resolved by the executor before this runs) — assigns into the run's `vars`, mutating the same object the executor holds for the rest of the run. Fires "out". */
export const setExecutor: NodeExecutor = async ({ params, exprCtx }) => {
  const name = params.name;
  if (typeof name !== "string" || !name) throw new Error("set node requires a non-empty `name` param");
  (exprCtx.vars as Record<string, unknown>)[name] = params.value;
  return { handle: "out", output: { name, value: params.value } };
};

const MAX_DELAY_MS = 60 * 60 * 1000; // 1h cap — workflows-design.md §4

/** `params.ms` — waits, honoring cancellation (the signal the executor passes in is already the combined run+timeout signal, so an abort here surfaces as this node's own failure/cancellation, same as any other node). Fires "out". */
export const delayExecutor: NodeExecutor = async ({ params, signal }) => {
  const ms = Number(params.ms ?? 0);
  if (!Number.isFinite(ms) || ms < 0) throw new Error("delay node requires a non-negative `ms` param");
  const clamped = Math.min(ms, MAX_DELAY_MS);

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, clamped);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      },
      { once: true },
    );
  });

  return { handle: "out" };
};

type SwitchCase = { case: string; condition: Condition };

/** `params.cases` — an ordered `{case, condition}[]`, evaluated in order. Fires `case:<value>` for the first match, or `default` if none match (workflows-design.md §4). */
export const switchExecutor: NodeExecutor = async ({ params, exprCtx }) => {
  const cases = params.cases as SwitchCase[] | undefined;
  if (!Array.isArray(cases)) throw new Error("switch node requires a `cases` array param");
  for (const { case: value, condition } of cases) {
    if (evaluateCondition(condition, exprCtx)) return { handle: `case:${value}`, output: { matched: value } };
  }
  return { handle: "default", output: { matched: null } };
};

export const logicNodeExecutors: Record<string, NodeExecutor> = {
  if: ifExecutor,
  set: setExecutor,
  delay: delayExecutor,
  switch: switchExecutor,
  loop: loopExecutor,
};
