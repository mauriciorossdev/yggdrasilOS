import type {
  AgentHarness,
  HarnessAttemptParams,
  HarnessAttemptResult,
  HarnessSupportContext,
} from "@yggdrasil/sdk";
import { registerHarness } from "@yggdrasil/kernel";

export const BUILTIN_ECHO_HARNESS_ID = "builtin-echo";

export function createEchoHarness(options?: { id?: string; label?: string }): AgentHarness {
  const id = options?.id ?? BUILTIN_ECHO_HARNESS_ID;
  return {
    id,
    label: options?.label ?? "Builtin Echo Harness",
    supports(_ctx: HarnessSupportContext) {
      return { supported: true, priority: 0 };
    },
    async runAttempt(params: HarnessAttemptParams): Promise<HarnessAttemptResult> {
      return {
        text: `echo: ${params.message}`,
        classification: "ok",
        metadata: { harnessId: id },
      };
    },
  };
}

export function registerBuiltinHarnesses(): void {
  registerHarness(createEchoHarness());
}
