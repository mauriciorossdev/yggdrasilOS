import type { Condition } from "./types.js";
import { resolvePath, type ExprContext } from "./expressions.js";

/** `Condition.left` is a raw dotted path ("nodes.a.output.ok"), not a `{{ }}`-wrapped expression — resolved the same way, just without the template syntax. `right` is always a literal to compare against, never a path. */
export function evaluateCondition(condition: Condition, ctx: ExprContext): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluateCondition(c, ctx));
  if ("any" in condition) return condition.any.some((c) => evaluateCondition(c, ctx));
  if ("not" in condition) return !evaluateCondition(condition.not, ctx);

  const left = resolvePath(condition.left, ctx);
  const right = condition.right;

  switch (condition.op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "contains":
      if (typeof left === "string" && typeof right === "string") return left.includes(right);
      if (Array.isArray(left)) return left.includes(right);
      return false;
    case "gt":
      return Number(left) > Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "exists":
      return left !== undefined && left !== null;
    case "matches":
      return typeof left === "string" && typeof right === "string" && new RegExp(right).test(left);
    default:
      // Fails closed on an op this build doesn't know yet, rather than
      // silently taking a branch based on a condition that was never
      // actually evaluated.
      return false;
  }
}
