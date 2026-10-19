import { randomUUID } from "node:crypto";
import { defineTool } from "@yggdrasil/tools-sdk";
import { getKernelContext } from "@yggdrasil/kernel";
import { runChannelTurn } from "@yggdrasil/pipeline";
import { getSessionStore } from "@yggdrasil/sessions";

const MAX_DELEGATION_DEPTH = 3;
const DEPTH_MARKER = "::sub:";

/**
 * Depth is derived from the session-key itself (how many "::sub:" hops it
 * already contains) rather than threaded through separately — ToolContext
 * doesn't carry the inbound message's metadata, and encoding it in the
 * sub-session key is self-contained: no schema/type changes needed anywhere
 * else in the pipeline.
 */
function delegationDepth(sessionKey: string): number {
  return sessionKey.split(DEPTH_MARKER).length - 1;
}

export const invokeAgentTool = defineTool({
  name: "invoke_agent",
  description:
    "Delegates a sub-task to another configured agent in this project by id, and returns that agent's " +
    "reply. Use this to hand off work to a specialized agent (e.g. an orchestrator calling a " +
    '"code-reviewer" or "researcher" agent) instead of trying to do everything yourself. The other agent ' +
    "runs its own full turn — its own system prompt, tools, provider/model — against the message you " +
    "give it, in a fresh sub-conversation; it does not see this conversation's history. Delegation is " +
    `capped at ${MAX_DELEGATION_DEPTH} levels deep to prevent runaway chains — a chain that hits the cap ` +
    "is refused rather than looping forever. See agents.list for available agent ids.",
  parameters: {
    type: "object",
    properties: {
      agentId: { type: "string", description: "id of the agent to delegate to." },
      message: { type: "string", description: "The task/question to hand to that agent." },
    },
    required: ["agentId", "message"],
  },
  riskLevel: "safe",
  async execute(ctx, args) {
    const agentId = String(args.agentId ?? "").trim();
    const message = String(args.message ?? "").trim();
    if (!agentId) throw new Error("invoke_agent: agentId is required");
    if (!message) throw new Error("invoke_agent: message is required");

    const depth = delegationDepth(ctx.sessionKey);
    if (depth >= MAX_DELEGATION_DEPTH) {
      return {
        delegated: false,
        error: `Delegation depth limit (${MAX_DELEGATION_DEPTH}) reached — refusing to delegate further to avoid a runaway chain.`,
      };
    }

    // Agent Flow runs stamp the calling agent's id and its reachable-edges
    // map onto every turn's metadata (see chat.send / buildAgentFlowEdgeMap).
    // When that's present, enforce it as a hard allowlist — not just a
    // system-prompt suggestion — so a supervisor can only ever delegate
    // along the edges actually drawn on the canvas. Absent it (e.g. a
    // hand-authored orchestrator agent used from the Chat tab), behavior is
    // unchanged from before this check existed: any known agentId works.
    const callerAgentId = ctx.metadata?.agentId as string | undefined;
    const edgeMap = ctx.metadata?.agentFlowEdges as Record<string, string[]> | undefined;
    if (edgeMap) {
      const reachable = callerAgentId ? edgeMap[callerAgentId] : undefined;
      if (!reachable?.includes(agentId)) {
        return {
          delegated: false,
          error: `Agent "${agentId}" is not reachable from "${callerAgentId ?? "(unknown)"}" via this flow's connections.`,
        };
      }
    }

    const kernelContext = getKernelContext();
    if (!kernelContext) throw new Error("invoke_agent: kernel not bootstrapped");

    if (!kernelContext.config.agents?.some((a) => a.id === agentId)) {
      return { delegated: false, error: `No agent with id "${agentId}" found. Check agents.list.` };
    }

    const subSessionKey = `${ctx.sessionKey}${DEPTH_MARKER}${agentId}:${randomUUID()}`;

    void ctx.events?.emit("agentflow.delegate.start", {
      parentSessionKey: ctx.sessionKey,
      agentId,
      subSessionKey,
    });

    const result = await runChannelTurn({
      config: kernelContext.config,
      workspaceRoot: kernelContext.workspaceRoot,
      sessionStore: getSessionStore(),
      // No interactive approval channel exists inside a nested delegation —
      // fail safe (deny) rather than silently auto-approving a destructive
      // tool call the user never saw a prompt for. The delegated agent can
      // still freely use non-destructive tools.
      approveTool: async () => false,
      events: ctx.events,
      onDelta: (delta) => {
        void ctx.events?.emit("chat.delta", { sessionKey: subSessionKey, text: delta, partial: true });
      },
      message: {
        channelId: "delegate",
        accountId: "default",
        sessionKey: subSessionKey,
        senderId: "orchestrator",
        body: message,
        // Forward the (unchanged) edge map + the target's own id, so the
        // target's own invoke_agent calls are in turn scoped to *its*
        // outgoing edges — self-propagating through however many hops the
        // flow has, still bounded by MAX_DELEGATION_DEPTH above.
        metadata: edgeMap ? { agentId, agentFlowEdges: edgeMap } : { agentId },
      },
    });

    void ctx.events?.emit("chat.final", {
      sessionKey: subSessionKey,
      text: result.replyText ?? "",
      harnessId: result.harnessId,
      usage: result.usage,
    });

    return {
      delegated: true,
      agentId,
      reply: result.replyText ?? "",
      harnessId: result.harnessId,
    };
  },
});
