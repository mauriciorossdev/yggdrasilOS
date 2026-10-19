import type { AgentFlowNode, AgentTeamEdge } from "../types.js";
import type { LeafPane } from "./paneTree.js";
import { buildLaunchCommand } from "../agentFlow/buildLaunchCommand.js";

/**
 * When `node` has outgoing edges (it's an orchestrator whose team members
 * are being spawned in this same batch — see buildFlowLeaves below),
 * appends a roster of those members' names/tasks to its initialPrompt.
 * Without this, a reloaded/re-materialized orchestrator has zero memory of
 * having "created" its team last time (each `claude` pane is a fresh
 * process/conversation — there's no session-resume for this harness) and
 * would try to create_pane duplicates of workers that are already starting
 * right alongside it. Only claude/antigravity/omp/copilot nodes have initialPrompt;
 * yggdrasil nodes are excluded (no such field, and edges are only ever
 * populated by auto-capture, which never creates yggdrasil nodes anyway).
 */
function withTeamRosterNote(node: AgentFlowNode, nodes: AgentFlowNode[], edges: AgentTeamEdge[]): AgentFlowNode {
  if (node.harness.type === "yggdrasil") return node;

  const childIds = edges.filter((e) => e.from === node.id).map((e) => e.to);
  if (childIds.length === 0) return node;
  const children = childIds.map((cid) => nodes.find((n) => n.id === cid)).filter((n): n is AgentFlowNode => !!n);
  if (children.length === 0) return node;

  const roster = children
    .map((c) => {
      const task = c.harness.type !== "yggdrasil" ? c.harness.initialPrompt : undefined;
      return `- ${c.name}: ${task ?? "(no stated task)"}`;
    })
    .join("\n");

  const note = [
    "",
    "",
    "--- Your team (spawned alongside you) ---",
    "These are separate live terminal panes being started in this same batch — not something you need to create:",
    roster,
    "",
    "Use write_pane/read_pane to coordinate them directly, or list_panes to confirm their current live ids. " +
      "Only call create_pane if you need members beyond these.",
  ].join("\n");

  return { ...node, harness: { ...node.harness, initialPrompt: (node.harness.initialPrompt ?? "") + note } };
}

/**
 * Which nodes a saved Team should actually spawn as real panes on load —
 * used by TerminalContainer.tsx's loadTeam, NOT by AgentFlowView's own
 * "Load into Terminal" (a fresh canvas may deliberately be a flat set of
 * independent agents with no delegation at all; forcing "only the first
 * one" there would silently break that).
 *
 * For a Team, though, spawning every recorded node every time is the wrong
 * model: workers only ever exist because an orchestrator's own conversation
 * called create_pane for them, and a `claude` pane has no session-resume —
 * every reload starts that conversation over from initialPrompt. Recreating
 * N frozen panes and hoping a roster note talks the orchestrator out of
 * duplicating them is fragile. Simpler and more robust: spawn only the
 * root(s) — nodes with outgoing edges (or, for a never-yet-live-run
 * manually-designed team with no edges at all, just the first node, same
 * as a genuine first run) — and let them recreate their team the exact way
 * that's already proven to work.
 */
export function selectTeamRootNodes(nodes: AgentFlowNode[], edges: AgentTeamEdge[]): AgentFlowNode[] {
  if (edges.length > 0) {
    const childIds = new Set(edges.map((e) => e.to));
    const roots = nodes.filter((n) => !childIds.has(n.id));
    if (roots.length > 0) return roots;
  }
  return nodes.length > 0 ? [nodes[0]!] : [];
}

/**
 * Pure per-node leaf builder shared by AgentFlowView's "Load into Terminal"
 * and the Terminal tab's saved-Team loader (TerminalContainer.tsx) — both
 * turn a set of AgentFlowNodes into terminal panes the same way, so the
 * command-resolution logic (yggdrasil vs claude/antigravity/omp/copilot) lives here
 * once instead of twice. `edges` is optional (plain Agent Flow canvases with
 * no orchestrator relationships pass none) — see withTeamRosterNote above.
 *
 * `nodes` controls what actually gets spawned as a leaf (e.g. just the
 * root(s) selected by selectTeamRootNodes). `allNodes` (defaults to `nodes`)
 * is only for withTeamRosterNote's child name/task lookup — a root's
 * children live in the full saved roster even though they're not being
 * spawned directly here, so that lookup needs the full list, not just
 * whatever subset is actually being turned into panes this call.
 */
export function buildFlowLeaves(
  nodes: AgentFlowNode[],
  projectPath: string | null,
  edges: AgentTeamEdge[] = [],
  allNodes: AgentFlowNode[] = nodes,
): { leaves: LeafPane[]; nodeIdToLeafId: Map<string, string> } {
  const cwd = projectPath ?? ".";
  const nodeIdToLeafId = new Map<string, string>(nodes.map((node) => [node.id, crypto.randomUUID()]));

  const leaves: LeafPane[] = nodes.map((node) => {
    const id = nodeIdToLeafId.get(node.id)!;
    if (node.harness.type === "yggdrasil") {
      // Assigned up front (not left for the TUI to mint internally) so
      // this pane's real conversation is always resolvable via
      // sessions.get — Delegate (TerminalPane.tsx) needs a known
      // sessionKey to fetch the clean, untruncated, un-markdown'd last
      // reply instead of screen-scraping the viewport.
      return {
        type: "leaf",
        id,
        title: node.name,
        cwd,
        yggdrasilAgentId: node.harness.agentId,
        flowNodeId: node.id,
        sessionKey: `tui:default:desktop-${crypto.randomUUID()}`,
      };
    }
    const rostered = withTeamRosterNote(node, allNodes, edges);
    const { command, args, initialPromptFlag, env } = buildLaunchCommand(rostered);
    return {
      type: "leaf",
      id,
      title: node.name,
      cwd,
      command,
      args,
      env,
      flowNodeId: node.id,
      initialPrompt: rostered.harness.type !== "yggdrasil" ? rostered.harness.initialPrompt : undefined,
      initialPromptFlag,
    };
  });

  return { leaves, nodeIdToLeafId };
}
