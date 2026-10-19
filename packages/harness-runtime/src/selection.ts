import type { YggdrasilConfig } from "@yggdrasil/config";
import type { AgentHarness, HarnessSupportContext } from "@yggdrasil/sdk";
import { getHarness, listHarnesses } from "@yggdrasil/kernel";
import { BUILTIN_ECHO_HARNESS_ID, createEchoHarness } from "./builtin/echo.js";

export type HarnessPolicy = "auto" | "pinned";

export type HarnessSelectionContext = HarnessSupportContext & {
  config: YggdrasilConfig;
};

export type HarnessSelectionResult = {
  harness: AgentHarness;
  reason: "pinned" | "auto_plugin" | "auto_builtin";
  harnessId: string;
  candidates: Array<{ id: string; priority: number; supported: boolean; reason?: string }>;
};

export function selectHarness(ctx: HarnessSelectionContext): HarnessSelectionResult {
  const policy = ctx.config.harness?.policy ?? "auto";
  const pinnedId = ctx.config.harness?.pinnedId?.trim();

  if (policy === "pinned" && pinnedId) {
    const pinned = getHarness(pinnedId);
    if (pinned) {
      return {
        harness: pinned.harness,
        reason: "pinned",
        harnessId: pinned.harness.id,
        candidates: [{ id: pinned.harness.id, priority: Infinity, supported: true }],
      };
    }
  }

  const candidates = listHarnesses().map(({ harness }) => {
    const support = harness.supports(ctx);
    return {
      id: harness.id,
      priority: support.supported ? (support.priority ?? 0) : -1,
      supported: support.supported,
      reason: support.supported ? support.reason : ("reason" in support ? support.reason : undefined),
    };
  });

  const supported = [...candidates]
    .filter((c) => c.supported)
    .sort((a, b) => b.priority - a.priority);

  if (supported.length > 0) {
    const best = supported[0]!;
    const entry = getHarness(best.id)!;
    const isBuiltin = best.id === BUILTIN_ECHO_HARNESS_ID;
    return {
      harness: entry.harness,
      reason: isBuiltin ? "auto_builtin" : "auto_plugin",
      harnessId: best.id,
      candidates,
    };
  }

  const fallback = createEchoHarness();
  return {
    harness: fallback,
    reason: "auto_builtin",
    harnessId: fallback.id,
    candidates,
  };
}
