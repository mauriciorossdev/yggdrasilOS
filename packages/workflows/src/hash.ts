import { createHash } from "node:crypto";
import type { Workflow } from "./types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * A grant (workflows-design.md §3/§6.2) is bound to this hash, not to the
 * workflow id — any change to what the workflow actually *does* invalidates
 * it. Deliberately excludes `node.name` and `node.position`: moving a node
 * on the canvas or renaming it is cosmetic and shouldn't force a re-grant.
 */
export function computeGraphHash(workflow: Pick<Workflow, "triggers" | "nodes" | "edges">): string {
  const shape = {
    triggers: workflow.triggers,
    edges: workflow.edges,
    nodes: workflow.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      target: n.target ?? null,
      params: n.params,
      onError: n.onError ?? "fail",
      retry: n.retry ?? null,
      timeoutMs: n.timeoutMs ?? null,
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(shape))).digest("hex");
}
