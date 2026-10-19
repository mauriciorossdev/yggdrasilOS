// Path-lookup only — no eval, no vm, no function calls (workflows-design.md
// §5.10). `{{ nodes.<id>.output.<path> }}` etc. resolve to a plain value
// lookup; nothing here can execute arbitrary code.

export type ExprContext = {
  nodes: Record<string, { output?: unknown }>;
  trigger?: unknown;
  vars: Record<string, unknown>;
  loop?: { item: unknown; index: number };
  run: { id: string };
};

const WHOLE_EXPR_RE = /^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/;
const ANY_EXPR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function getPath(root: unknown, path: string): unknown {
  if (!path) return root;
  let cur: unknown = root;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Resolves a single dotted path like "nodes.a.output.text" or "vars.foo" against the run context. Exported for conditions.ts, which uses raw paths (not `{{ }}`-wrapped) in `Condition.left`. */
export function resolvePath(path: string, ctx: ExprContext): unknown {
  const dot = path.indexOf(".");
  const root = dot === -1 ? path : path.slice(0, dot);
  const rest = dot === -1 ? "" : path.slice(dot + 1);
  switch (root) {
    case "nodes":
      return getPath(ctx.nodes, rest);
    case "trigger":
      return rest ? getPath(ctx.trigger, rest) : ctx.trigger;
    case "vars":
      return getPath(ctx.vars, rest);
    case "loop":
      return rest ? getPath(ctx.loop, rest) : ctx.loop;
    case "run":
      return rest ? getPath(ctx.run, rest) : ctx.run;
    default:
      return undefined;
  }
}

/**
 * Resolves `{{ path }}` placeholders in a single param value. A value that
 * is *just* one expression keeps its real type (an object/array/number
 * survives intact); a value with surrounding or multiple expressions is
 * stringified into the text, same rule as workflows-design.md §5.10.
 */
export function resolveExpression(value: unknown, ctx: ExprContext): unknown {
  if (typeof value !== "string" || !value.includes("{{")) return value;

  const whole = value.match(WHOLE_EXPR_RE);
  if (whole) return resolvePath(whole[1]!, ctx);

  return value.replace(ANY_EXPR_RE, (_m, path: string) => {
    const resolved = resolvePath(path, ctx);
    if (resolved === undefined || resolved === null) return "";
    // An object/array stringified with plain `String()` collapses to the
    // useless "[object Object]" — JSON.stringify is what anyone interpolating
    // e.g. {{ nodes.a.output.body }} into a prompt or URL actually wants.
    // Primitives (string/number/boolean) still go through String() so a
    // plain value doesn't pick up JSON's extra quoting (`"5"` vs `5`).
    if (typeof resolved === "object") return JSON.stringify(resolved);
    return String(resolved);
  });
}

/** Resolves every value in a node's `params` object — arrays/objects are walked recursively so `{{ }}` can appear nested, e.g. inside an http.request body. */
export function resolveParams(params: Record<string, unknown>, ctx: ExprContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) out[key] = resolveValue(value, ctx);
  return out;
}

function resolveValue(value: unknown, ctx: ExprContext): unknown {
  if (typeof value === "string") return resolveExpression(value, ctx);
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveValue(v, ctx);
    return out;
  }
  return value;
}
