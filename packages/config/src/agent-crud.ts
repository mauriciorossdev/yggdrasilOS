import type { AgentConfig } from "./index.js";
import { readConfigFile, writeConfigFile } from "./file.js";
import { readGlobalAgents, writeGlobalAgents, type AgentWithScope } from "./global-agents.js";

export type CreateAgentInput = {
  agent: AgentConfig;
  scope: "local" | "global";
  workspaceRoot?: string;
};

export async function createAgent(input: CreateAgentInput): Promise<AgentWithScope> {
  const { agent, scope, workspaceRoot } = input;
  const id = agent.id.trim();
  if (!id) {
    throw new Error("agents.create: id is required");
  }
  if (scope !== "local" && scope !== "global") {
    throw new Error(`agents.create: scope must be "local" or "global", got ${JSON.stringify(scope)}`);
  }

  if (scope === "local") {
    if (!workspaceRoot) {
      throw new Error('agents.create: workspaceRoot is required for scope "local"');
    }
    const [{ config: current }, globalAgents] = await Promise.all([
      readConfigFile(workspaceRoot),
      readGlobalAgents(),
    ]);
    const existing = current.agents ?? [];
    if (existing.some((a) => a.id === id)) {
      throw new Error(`agents.create: agent "${id}" already exists in local scope`);
    }
    if (globalAgents.some((a) => a.id === id)) {
      throw new Error(
        `agents.create: agent "${id}" already exists in global scope — choose a different id, or create it locally under a different name`,
      );
    }
    await writeConfigFile(workspaceRoot, { agents: [...existing, { ...agent, id }] });
    return { ...agent, id, scope: "local" };
  }

  const existingGlobal = await readGlobalAgents();
  if (existingGlobal.some((a) => a.id === id)) {
    throw new Error(`agents.create: agent "${id}" already exists in global scope`);
  }
  await writeGlobalAgents([...existingGlobal, { ...agent, id }]);
  return { ...agent, id, scope: "global" };
}

export type UpdateAgentInput = {
  agent: AgentConfig;
  scope: "local" | "global";
  workspaceRoot?: string;
};

/** Edits an existing agent in place — id and scope are the identity, not editable via this call. */
export async function updateAgent(input: UpdateAgentInput): Promise<AgentWithScope> {
  const { agent, scope, workspaceRoot } = input;
  const id = agent.id.trim();
  if (!id) {
    throw new Error("agents.update: id is required");
  }
  if (scope !== "local" && scope !== "global") {
    throw new Error(`agents.update: scope must be "local" or "global", got ${JSON.stringify(scope)}`);
  }

  if (scope === "local") {
    if (!workspaceRoot) {
      throw new Error('agents.update: workspaceRoot is required for scope "local"');
    }
    const { config: current } = await readConfigFile(workspaceRoot);
    const existing = current.agents ?? [];
    const idx = existing.findIndex((a) => a.id === id);
    if (idx === -1) {
      throw new Error(`agents.update: agent "${id}" not found in local scope`);
    }
    const next = [...existing];
    next[idx] = { ...agent, id };
    await writeConfigFile(workspaceRoot, { agents: next });
    return { ...agent, id, scope: "local" };
  }

  const existingGlobal = await readGlobalAgents();
  const idx = existingGlobal.findIndex((a) => a.id === id);
  if (idx === -1) {
    throw new Error(`agents.update: agent "${id}" not found in global scope`);
  }
  const next = [...existingGlobal];
  next[idx] = { ...agent, id };
  await writeGlobalAgents(next);
  return { ...agent, id, scope: "global" };
}

export type DeleteAgentInput = {
  id: string;
  scope: "local" | "global";
  workspaceRoot?: string;
};

export async function deleteAgent(input: DeleteAgentInput): Promise<void> {
  const { scope, workspaceRoot } = input;
  const id = input.id.trim();
  if (!id) {
    throw new Error("agents.delete: id is required");
  }
  if (scope !== "local" && scope !== "global") {
    throw new Error(`agents.delete: scope must be "local" or "global", got ${JSON.stringify(scope)}`);
  }

  if (scope === "local") {
    if (!workspaceRoot) {
      throw new Error('agents.delete: workspaceRoot is required for scope "local"');
    }
    const { config: current } = await readConfigFile(workspaceRoot);
    const existing = current.agents ?? [];
    if (!existing.some((a) => a.id === id)) {
      throw new Error(`agents.delete: agent "${id}" not found in local scope`);
    }
    await writeConfigFile(workspaceRoot, { agents: existing.filter((a) => a.id !== id) });
    return;
  }

  const existingGlobal = await readGlobalAgents();
  if (!existingGlobal.some((a) => a.id === id)) {
    throw new Error(`agents.delete: agent "${id}" not found in global scope`);
  }
  await writeGlobalAgents(existingGlobal.filter((a) => a.id !== id));
}
