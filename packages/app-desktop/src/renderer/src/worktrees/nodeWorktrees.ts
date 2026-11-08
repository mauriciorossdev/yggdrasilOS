import type { AgentFlowNode } from "../types.js";
import { cleanGatewayError, slugifyWorktreeName } from "./create.js";

type Call = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;

const NAME_TAKEN = /already (exists|used)|branch .* already exists/;

/**
 * Creates the worktree for every Agent Flow node that asks for one
 * ("Isolated worktree") and returns where each lives, by node id. The name comes
 * from the node's name; when that is taken (an earlier load) it gets -2, -3, ...
 * Throws on the first failure: the caller must not fall back to the shared
 * folder, because isolation was asked for.
 */
export async function createNodeWorktrees(call: Call, nodes: AgentFlowNode[]): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  for (const node of nodes) {
    if (!node.worktree) continue;
    const stem = slugifyWorktreeName(node.name) || "agent";
    let created: string | null = null;
    let lastError = "";
    for (let n = 1; n <= 20 && !created; n++) {
      try {
        const res = await call<{ path: string }>("git.worktreeAdd", { repo: ".", name: n === 1 ? stem : `${stem}-${n}` });
        created = res.path;
      } catch (err) {
        lastError = cleanGatewayError(err instanceof Error ? err.message : String(err));
        if (!NAME_TAKEN.test(lastError)) break;
      }
    }
    if (!created) throw new Error(`Could not create a worktree for "${node.name}": ${lastError}`);
    paths.set(node.id, created);
  }
  return paths;
}
