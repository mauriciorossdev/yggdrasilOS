import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type AgentFlowHarness =
  | { type: "yggdrasil"; agentId: string }
  | {
      type: "claude";
      systemPromptAppend?: string;
      model?: string;
      effort?: "low" | "medium" | "high" | "xhigh" | "max";
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
