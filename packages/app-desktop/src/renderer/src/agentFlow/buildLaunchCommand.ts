import type { AgentFlowNode } from "../types.js";

/**
 * Pure per-harness command/args builder for "Load into Terminal". The
 * yggdrasil case is deliberately absent here — it has no PATH-resolved
 * binary of its own; the leaf instead carries `yggdrasilAgentId` and main
 * resolves the actual CLI invocation itself (see main/terminals.ts's
 * resolveYggdrasilTuiCommand — it needs process.execPath / the CLI's
 * resolved entry path, unavailable to the renderer).
 *
 * `initialPrompt` is deliberately NOT baked into `args` here — it's carried
 * on the leaf's own `initialPrompt`/`initialPromptFlag` fields instead (see
 * buildFlowLeaves.ts) and appended to args only at the moment
 * main/terminals.ts actually spawns a *fresh* process for it. Baking it
 * into `args` directly would mean a plain hydrate-restore respawn (an app
 * restart, not a real re-launch) re-fires the original task every time —
 * see paneTree.ts's HYDRATE case, which strips it precisely because of
 * that. `initialPromptFlag` exists because the three harnesses don't agree
 * on how an initial message is passed (bare positional vs. a flag) — main
 * shouldn't need to know that per-CLI convention itself.
 */
/**
 * `claude --cloud "<desc>"` creates a cloud session and EXITS (confirmed
 * live 2026-10-02: prints "Created cloud session... / Resume with: claude
 * --teleport <id>", then `[process exited (code 0)]`) — it does not stay
 * attached the way a plain local `claude` invocation does. Getting an
 * actually-live pane (so write_pane/read_pane keep working on this node,
 * same as a local one) needs a second step: `claude --teleport <id>`, run
 * separately, with the id only known from the first command's own output.
 *
 * This builds a one-line POSIX shell pipeline that does both steps in a
 * single process: run the create step, grep the session id out of its
 * output, then `exec` into `claude --teleport <id>` — `exec` REPLACES the
 * shell process instead of forking a child, so the pty's pid still ends up
 * pointing at the final live `claude --teleport` process (findTerminalIdByPid
 * in main/terminals.ts keys off that pid). The description travels via an
 * env var (`YGG_CLOUD_DESC`), read with `"$YGG_CLOUD_DESC"` rather than
 * string-interpolated into the script, so it's safe regardless of quotes/
 * `$`/backticks in it.
 *
 * macOS/Linux only (spawns `/bin/sh`) — no Windows equivalent wired yet.
 * Known simplification: systemPromptAppend/model/effort/addDirs are NOT
 * threaded through the cloud-create step yet (only the description is) —
 * scoped to fixing the create-then-exit bug, not full flag parity.
 */
function buildCloudLaunch(description: string): { command: string; args: string[]; env: Record<string, string> } {
  const script = [
    'out=$(claude --cloud "$YGG_CLOUD_DESC" 2>&1)',
    'printf "%s\\n" "$out"',
    'id=$(printf "%s\\n" "$out" | grep -oE "session_[A-Za-z0-9]+" | tail -1)',
    'if [ -n "$id" ]; then exec claude --teleport "$id"; ' +
      'else echo "Could not find the cloud session id in the output above - staying on a plain shell."; exec "${SHELL:-/bin/sh}"; fi',
  ].join("; ");
  return { command: "/bin/sh", args: ["-c", script], env: { YGG_CLOUD_DESC: description } };
}

export function buildLaunchCommand(
  node: AgentFlowNode,
): { command?: string; args?: string[]; initialPromptFlag?: string; env?: Record<string, string> } {
  switch (node.harness.type) {
    case "yggdrasil":
      return {};

    case "claude": {
      const h = node.harness;
      if (h.cloud) {
        return buildCloudLaunch(h.initialPrompt?.trim() || node.name);
      }
      const args: string[] = [];
      if (h.systemPromptAppend) args.push("--append-system-prompt", h.systemPromptAppend);
      if (h.model) args.push("--model", h.model);
      if (h.effort) args.push("--effort", h.effort);
      for (const dir of h.addDirs ?? []) args.push("--add-dir", dir);
      // Bare positional, last — opens interactively with this message
      // already sent instead of processing and exiting (that's -p/--print,
      // deliberately omitted).
      return { command: "claude", args };
    }

    case "antigravity": {
      const h = node.harness;
      const args: string[] = [];
      if (h.model) args.push("--model", h.model);
      if (h.effort) args.push("--effort", h.effort);
      if (h.mode) args.push("--mode", h.mode);
      for (const dir of h.addDirs ?? []) args.push("--add-dir", dir);
      // agy's usage: -i/--prompt-interactive runs an initial prompt
      // interactively then continues the session — a flag, not bare.
      return { command: "agy", args, initialPromptFlag: "-i" };
    }

    case "omp": {
      const h = node.harness;
      const args: string[] = [];
      if (h.systemPromptAppend) args.push("--append-system-prompt", h.systemPromptAppend);
      if (h.model) args.push("--model", h.model);
      if (h.thinking) args.push("--thinking", h.thinking);
      if (h.approvalMode) args.push("--approval-mode", h.approvalMode);
      for (const dir of h.addDirs ?? []) args.push("--add-dir", dir);
      // omp has no -i/interactive-prompt flag — MESSAGES is a bare
      // positional argument; passed last (no leading `-p`), it opens
      // interactively with that initial message instead of processing and
      // exiting.
      return { command: "omp", args };
    }

    case "copilot": {
      const h = node.harness;
      const args: string[] = [];
      if (h.model) args.push("--model", h.model);
      if (h.allowAllTools) args.push("--allow-all-tools");
      for (const dir of h.addDirs ?? []) args.push("--add-dir", dir);
      // Same convention as claude/omp — a bare positional prompt opens
      // copilot interactively with that message already sent, unlike
      // -p/--prompt which prints a response and exits (deliberately
      // omitted).
      return { command: "copilot", args };
    }
  }
}
