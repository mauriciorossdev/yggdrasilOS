import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentFlowNode } from "./agentFlow.js";

/** Records which node spawned which — populated only for auto-captured orchestrator/worker relationships (create_pane's sourcePaneId). Manually-designed teams (Agent Flow's "Save as Team…") never set this; unlike AgentFlowEdge it carries no id/label, just the relationship. */
export type AgentTeamEdge = { from: string; to: string };

/** A named, saved snapshot of Agent Flow nodes — loadable into the Terminal tab without going through the Agent Flow canvas. No supervisor (that's a canvas-only orchestration concept); `edges` here is a lighter, auto-capture-only relationship record, not Agent Flow's full AgentFlowEdge. */
export type AgentTeam = { id: string; name: string; nodes: AgentFlowNode[]; edges?: AgentTeamEdge[] };

type AgentTeamsFile = { teams: AgentTeam[] };

function teamsPath(projectRoot: string): string {
  return join(projectRoot, "agent-teams.json");
}

async function readTeamsFile(projectRoot: string): Promise<AgentTeamsFile> {
  try {
    const raw = await readFile(teamsPath(projectRoot), "utf8");
    return JSON.parse(raw) as AgentTeamsFile;
  } catch {
    return { teams: [] };
  }
}

async function writeTeamsFile(projectRoot: string, file: AgentTeamsFile): Promise<void> {
  await mkdir(dirname(teamsPath(projectRoot)), { recursive: true });
  await writeFile(teamsPath(projectRoot), JSON.stringify(file, null, 2), "utf8");
}

export async function readAgentTeams(projectRoot: string): Promise<AgentTeam[]> {
  return (await readTeamsFile(projectRoot)).teams;
}

export async function saveAgentTeam(projectRoot: string, team: AgentTeam): Promise<AgentTeam[]> {
  const file = await readTeamsFile(projectRoot);
  const index = file.teams.findIndex((t) => t.id === team.id);
  if (index === -1) file.teams.push(team);
  else file.teams[index] = team;
  await writeTeamsFile(projectRoot, file);
  return file.teams;
}

export async function deleteAgentTeam(projectRoot: string, id: string): Promise<AgentTeam[]> {
  const file = await readTeamsFile(projectRoot);
  file.teams = file.teams.filter((t) => t.id !== id);
  await writeTeamsFile(projectRoot, file);
  return file.teams;
}

export async function renameAgentTeam(projectRoot: string, id: string, name: string): Promise<AgentTeam[]> {
  const file = await readTeamsFile(projectRoot);
  const team = file.teams.find((t) => t.id === id);
  if (team) team.name = name;
  await writeTeamsFile(projectRoot, file);
  return file.teams;
}

/**
 * Legacy fixed id — every auto-captured pane used to land in one single
 * "Auto-captured" team regardless of which orchestrator spawned it,
 * silently merging unrelated sessions together over time. Still readable/
 * loadable/renameable/deletable like any other team; new captures no longer
 * default here (see findTeamContainingNode below) — this only still gets
 * used as the fallback team id in the one case with no orchestrator to key
 * off of at all (see recordAutoCapturedNode).
 */
export const AUTO_CAPTURED_TEAM_ID = "auto-captured";

/** Finds whichever saved team already contains a node with this id, if any — used to keep growing the same team across repeated create_pane calls or Team reloads from the same orchestrator, rather than forking a new team every time. */
function findTeamContainingNode(teams: AgentTeam[], nodeId: string): AgentTeam | undefined {
  return teams.find((t) => t.nodes.some((n) => n.id === nodeId));
}

const GRID_COLS = 3;
const GRID_STEP_X = 320;
const GRID_STEP_Y = 260;

function upsertTeamNode(team: AgentTeam, node: { id: string; name: string; initialPrompt?: string }): void {
  const index = team.nodes.findIndex((n) => n.id === node.id);
  const existing = index === -1 ? undefined : team.nodes[index];
  const position =
    existing?.position ??
    { x: (team.nodes.length % GRID_COLS) * GRID_STEP_X, y: Math.floor(team.nodes.length / GRID_COLS) * GRID_STEP_Y };
  // Preserve a known initialPrompt if this call doesn't carry one — e.g. the
  // orchestrator node created on-demand below (source.name only) shouldn't
  // blank out a prompt it was given on some earlier call.
  const initialPrompt =
    node.initialPrompt ?? (existing?.harness.type === "claude" ? existing.harness.initialPrompt : undefined);
  const agentFlowNode: AgentFlowNode = {
    id: node.id,
    name: node.name,
    position,
    harness: { type: "claude", initialPrompt },
  };
  if (index === -1) team.nodes.push(agentFlowNode);
  else team.nodes[index] = agentFlowNode;
}

function defaultTeamName(purpose: string): string {
  const oneLine = purpose.replace(/\s+/g, " ").trim();
  return oneLine.length > 0 ? oneLine.slice(0, 60) : "New Team";
}

/**
 * Appends (or updates, by node id — a duplicate create_pane call for the
 * same pane id is idempotent) one node to a saved team, creating that team
 * on first use. `node.id` is the pane's own id so it's traceable back to
 * the live terminal that spawned it.
 *
 * Which team: reuses whichever team already contains `source`'s node (the
 * *same* orchestrator, by its stable flowNodeId — recognized across
 * repeated create_pane calls in one session and across Team reloads), so
 * one orchestrator's ongoing work keeps landing in one team. If `source`'s
 * node isn't in any saved team yet, this is a genuinely new orchestrator —
 * a brand-new team is created for it, named after this first task, instead
 * of every unrelated session piling into one shared bucket (the old
 * behavior — see AUTO_CAPTURED_TEAM_ID). With no `source` at all (the
 * calling pane's identity couldn't be resolved), falls back to keying off
 * the created node itself, then AUTO_CAPTURED_TEAM_ID as a last resort.
 *
 * `source`, when given (paneControlServer.ts resolved the calling pane's id
 * via /whoami), also records the orchestrator: an edge from source→node,
 * and — if this is the first time that pane's been seen — a node for it
 * too (its own task/initialPrompt is unknown here, only its title, since it
 * wasn't necessarily itself created via create_pane).
 */
export async function recordAutoCapturedNode(
  projectRoot: string,
  node: { id: string; name: string; initialPrompt: string },
  source?: { id: string; name: string },
): Promise<void> {
  const file = await readTeamsFile(projectRoot);

  const keyId = source?.id ?? node.id;
  let team = findTeamContainingNode(file.teams, keyId) ?? file.teams.find((t) => t.id === AUTO_CAPTURED_TEAM_ID && !source);
  if (!team) {
    team = { id: randomUUID(), name: defaultTeamName(node.initialPrompt), nodes: [], edges: [] };
    file.teams.push(team);
  }
  if (!team.edges) team.edges = [];

  upsertTeamNode(team, node);

  if (source && source.id !== node.id) {
    if (!team.nodes.some((n) => n.id === source.id)) {
      upsertTeamNode(team, { id: source.id, name: source.name });
    }
    if (!team.edges.some((e) => e.from === source.id && e.to === node.id)) {
      team.edges.push({ from: source.id, to: node.id });
    }
  }

  await writeTeamsFile(projectRoot, file);
}
