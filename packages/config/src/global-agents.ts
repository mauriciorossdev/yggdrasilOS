import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentConfig } from "./index.js";

export function resolveGlobalAgentsPath(): string {
  return join(homedir(), ".yggdrasil", "agents.json");
}

export async function readGlobalAgents(): Promise<AgentConfig[]> {
  const path = resolveGlobalAgentsPath();
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as { agents?: unknown };
    return Array.isArray(raw.agents) ? (raw.agents as AgentConfig[]) : [];
  } catch {
    return [];
  }
}

export async function writeGlobalAgents(agents: AgentConfig[]): Promise<string> {
  const path = resolveGlobalAgentsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ agents }, null, 2)}\n`, "utf8");
  return path;
}

export type AgentWithScope = AgentConfig & { scope: "local" | "global" };

export function mergeAgentSources(local: AgentConfig[], global: AgentConfig[]): AgentWithScope[] {
  const localIds = new Set(local.map((a) => a.id));
  return [
    ...local.map((a): AgentWithScope => ({ ...a, scope: "local" })),
    ...global.filter((a) => !localIds.has(a.id)).map((a): AgentWithScope => ({ ...a, scope: "global" })),
  ];
}
