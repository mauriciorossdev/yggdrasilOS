import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type AgentFlowHarness =
  | {
      type: "yggdrasil";
      agentId: string;
      /** Metadata only, like the other harnesses' initialPrompt: never auto-submitted (see main/terminals.ts). */
      initialPrompt?: string;
      /** `yggdrasil tui --model`: override for the agent's own model on every message. */
      model?: string;
      /** `yggdrasil tui --mode`: approval mode the session starts in. */
      approvalMode?: "auto" | "plan" | "restrict" | "yolo";
      /** Reopen this node's previous conversation instead of starting a new one (see buildFlowLeaves.ts). */
      continueSession?: boolean;
    }
  | {
      type: "claude";
      systemPromptAppend?: string;
      model?: string;
      effort?: "low" | "medium" | "high" | "xhigh" | "max";
      /** --permission-mode (see buildLaunchCommand.ts). Unset = claude's own default. Ignored for cloud nodes. */
      /** --continue: most recent conversation in the project folder. Ignored when resumeSession is set, and for cloud nodes. */
      continueSession?: boolean;
      /** --resume=<session id or name>. Ignored for cloud nodes. */
      resumeSession?: string;
      /** --name: display name for the session, which makes it resumable by that name later. */
      sessionName?: string;
      permissionMode?: "acceptEdits" | "auto" | "bypassPermissions" | "manual" | "dontAsk" | "plan";
      /** --allowedTools: tool rules that run without asking, e.g. "Read", "Bash(git log:*)". Ignored for cloud nodes. */
      allowedTools?: string[];
      /** --disallowedTools: tool rules that are always refused. Ignored for cloud nodes. */
      disallowedTools?: string[];
      addDirs?: string[];
      /** Bare positional arg (see buildLaunchCommand.ts) — opens claude interactively with this message already sent, same convention as omp's initialPrompt. */
      initialPrompt?: string;
      /** --cloud (see buildLaunchCommand.ts) — runs this node as a Claude Code cloud session instead of a local pty process. */
      cloud?: boolean;
    }
  | {
      type: "antigravity";
      initialPrompt?: string;
      model?: string;
      effort?: "low" | "medium" | "high";
      mode?: "accept-edits" | "plan";
      addDirs?: string[];
    }
  | {
      type: "omp";
      systemPromptAppend?: string;
      model?: string;
      thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "auto";
      approvalMode?: "always-ask" | "write" | "yolo";
      addDirs?: string[];
      initialPrompt?: string;
    }
  | {
      type: "copilot";
      model?: string;
      addDirs?: string[];
      allowAllTools?: boolean;
      /** Bare positional arg (see buildLaunchCommand.ts) — opens copilot interactively with this message already sent, same convention as claude/omp. */
      initialPrompt?: string;
    };

export type AgentFlowNode = {
  id: string;
  name: string;
  /** Canvas position (AgentFlowCanvas, react-flow). */
  position: { x: number; y: number };
  harness: AgentFlowHarness;
  /** Free-form note, e.g. "reports findings to Supervisor" — still just a human-readable annotation, not read by "Run Flow". */
  communication?: string;
  /** Feature doc (project-relative, notes/features/x.md) this node was created with — create_pane's specPath. */
  specPath?: string;
  /** Run this node's pane in its own git worktree (<repo>/.yggdrasil/worktrees/<name>) instead of the project folder. */
  worktree?: boolean;
};

/**
 * For a yggdrasil-harness node, this is a real delegation channel — "Run
 * Flow" (app-desktop's AgentFlowView) turns these into an invoke_agent
 * allowlist (buildAgentFlowEdgeMap), enforced server-side by
 * invoke-agent-tool.ts. `label` stays a display-only annotation. Edges
 * touching a claude/antigravity/omp/copilot node are still just
 * visual/inert — those harnesses have no gateway-programmatic hook to route
 * into.
 */
export type AgentFlowEdge = { id: string; from: string; to: string; label?: string };

export type AgentFlowSupervisor = {
  type: "human" | "yggdrasil" | "claude" | "antigravity" | "omp" | "copilot";
  agentId?: string;
  systemPromptAppend?: string;
  initialPrompt?: string;
  note?: string;
};

export type AgentFlow = {
  version: 1;
  name: string;
  nodes: AgentFlowNode[];
  edges: AgentFlowEdge[];
  supervisor: AgentFlowSupervisor;
  updatedAt: number;
};

function flowPath(projectRoot: string): string {
  return join(projectRoot, "agent-flow.json");
}

export async function readAgentFlow(projectRoot: string): Promise<AgentFlow | null> {
  try {
    const raw = await readFile(flowPath(projectRoot), "utf8");
    return JSON.parse(raw) as AgentFlow;
  } catch {
    return null;
  }
}

export async function writeAgentFlow(projectRoot: string, flow: AgentFlow): Promise<void> {
  await mkdir(dirname(flowPath(projectRoot)), { recursive: true });
  await writeFile(flowPath(projectRoot), JSON.stringify(flow, null, 2), "utf8");
}
