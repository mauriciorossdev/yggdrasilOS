import { getKernelContext } from "@yggdrasil/kernel";

// Same trick as tool-google/src/account.ts — plugins reach the (single)
// project's workspaceRoot through the kernel context.
export function getWorkspaceRootOrThrow(methodName: string): string {
  const workspaceRoot = getKernelContext()?.workspaceRoot;
  if (!workspaceRoot) throw new Error(`${methodName}: no workspaceRoot configured for this gateway`);
  return workspaceRoot;
}
