/** A checkout git knows about: a repo's own working copy or one of its linked worktrees. */
export type Checkout = { path: string; branch?: string; detached: boolean };

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * The branch a terminal opened at `cwd` is working on: that of the checkout holding the folder
 * (the deepest one, since a linked worktree can live inside the main checkout). Undefined when `cwd`
 * isn't inside any known checkout.
 */
export function branchForCwd(checkouts: Checkout[], cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const dir = normalize(cwd);
  let best: Checkout | undefined;
  let bestLength = -1;
  for (const c of checkouts) {
    const root = normalize(c.path);
    const inside = dir === root || dir.startsWith(`${root}/`);
    if (inside && root.length > bestLength) {
      best = c;
      bestLength = root.length;
    }
  }
  if (!best) return undefined;
  return best.branch ?? "(detached)";
}
