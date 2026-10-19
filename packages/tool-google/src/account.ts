import { getKernelContext } from "@yggdrasil/kernel";
import { readConfigFile, writeConfigFile } from "@yggdrasil/config";
import type { TokenResponse } from "./oauth.js";

export type GoogleAccount = {
  refreshToken: string;
  scopes: string[];
  connectedAt: number;
};

// Plugin gateway methods only get {config, events, logger} (GatewayHandlerContext,
// @yggdrasil/sdk) — no workspaceRoot, unlike core gateway methods in
// methods.ts. getKernelContext() is the documented way a plugin reaches it
// (see tool-agents/create-agent-tool.ts for the same pattern) — the kernel
// process only ever runs one project, so this is safe to read from anywhere.
export function getWorkspaceRootOrThrow(methodName: string): string {
  const workspaceRoot = getKernelContext()?.workspaceRoot;
  if (!workspaceRoot) {
    throw new Error(`${methodName}: no workspaceRoot configured for this gateway`);
  }
  return workspaceRoot;
}

// Reads straight off disk (not the kernel's possibly-stale in-memory config)
// — same freshness reasoning as gateway/methods.ts's auth.apiKeys.list.
export async function getGoogleAccount(workspaceRoot: string): Promise<GoogleAccount | null> {
  const { config } = await readConfigFile(workspaceRoot);
  const raw = config.connectors?.google?.accounts?.default as Partial<GoogleAccount> | undefined;
  if (!raw?.refreshToken) return null;
  return {
    refreshToken: raw.refreshToken,
    scopes: raw.scopes ?? [],
    connectedAt: raw.connectedAt ?? 0,
  };
}

// Hand-merged rather than routed through config.patch's validateConfigPatch
// pipeline — same reasoning as agents.create/update/delete and
// auth.apiKeys.revoke in gateway/methods.ts: connectors isn't one of
// mergeConfig's explicitly deep-merged keys, so writing just
// {connectors:{google:{accounts:{default}}}} without spreading the existing
// connectors object first would silently drop every other configured
// connector (and every other google account, if that's ever a thing).
export async function saveGoogleAccount(workspaceRoot: string, tokens: TokenResponse): Promise<void> {
  if (!tokens.refresh_token) {
    throw new Error(
      "connectors.google.completeAuth: Google didn't return a refresh_token — this happens when the account " +
        "already granted consent before without prompt=consent taking effect. Revoke access for this app at " +
        "https://myaccount.google.com/permissions and try connecting again.",
    );
  }

  const { config: current } = await readConfigFile(workspaceRoot);
  const account: GoogleAccount = {
    refreshToken: tokens.refresh_token,
    scopes: tokens.scope.split(" ").filter(Boolean),
    connectedAt: Date.now(),
  };

  const patch = {
    connectors: {
      ...current.connectors,
      google: {
        ...current.connectors?.google,
        enabled: true,
        accounts: { ...current.connectors?.google?.accounts, default: account },
      },
    },
  };
  await writeConfigFile(workspaceRoot, patch);
}
