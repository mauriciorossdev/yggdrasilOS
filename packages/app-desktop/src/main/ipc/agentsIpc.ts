// IPC for Agent Flow, teams, flow templates, roles and skills.
import { homedir } from "node:os";
import { app, ipcMain, shell } from "electron";
import { type AgentFlow, readAgentFlow, writeAgentFlow } from "../agentFlow.js";
import { type AgentTeam, deleteAgentTeam, readAgentTeams, renameAgentTeam, saveAgentTeam } from "../agentTeams.js";
import {
  type CustomFlowTemplate,
  deleteCustomFlowTemplate,
  loadCustomFlowTemplates,
  saveCustomFlowTemplate,
} from "../flowTemplates.js";
import { getProject } from "../projects.js";
import { type CustomRole, deleteCustomRole, loadCustomRoles, saveCustomRole } from "../roles.js";
import { SkillCreateError, createProjectSkill, listSkills } from "../skills.js";

export function registerAgentsIpc(): void {
  ipcMain.handle("agentFlow:get", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) return null;
    return readAgentFlow(project.path);
  });
  ipcMain.handle("agentFlow:save", async (_event, projectId: string, flow: AgentFlow) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    await writeAgentFlow(project.path, flow);
  });
  ipcMain.handle("agentTeams:list", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) return [];
    return readAgentTeams(project.path);
  });
  ipcMain.handle("agentTeams:save", async (_event, projectId: string, team: AgentTeam) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    return saveAgentTeam(project.path, team);
  });
  ipcMain.handle("agentTeams:delete", async (_event, projectId: string, id: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    return deleteAgentTeam(project.path, id);
  });
  ipcMain.handle("agentTeams:rename", async (_event, projectId: string, id: string, name: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    return renameAgentTeam(project.path, id, name);
  });
  ipcMain.handle("roles:listCustom", async (): Promise<CustomRole[]> => loadCustomRoles(app.getPath("userData")));
  ipcMain.handle(
    "roles:saveCustom",
    async (_event, role: { label: string; summary?: string; systemPrompt: string }): Promise<CustomRole[]> =>
      saveCustomRole(app.getPath("userData"), role),
  );
  ipcMain.handle(
    "roles:deleteCustom",
    async (_event, id: string): Promise<CustomRole[]> => deleteCustomRole(app.getPath("userData"), id),
  );
  ipcMain.handle(
    "flowTemplates:listCustom",
    async (): Promise<CustomFlowTemplate[]> => loadCustomFlowTemplates(app.getPath("userData")),
  );
  ipcMain.handle(
    "flowTemplates:saveCustom",
    async (
      _event,
      template: { label: string; summary?: string; prompt: string },
    ): Promise<CustomFlowTemplate[]> => saveCustomFlowTemplate(app.getPath("userData"), template),
  );
  ipcMain.handle(
    "flowTemplates:deleteCustom",
    async (_event, id: string): Promise<CustomFlowTemplate[]> => deleteCustomFlowTemplate(app.getPath("userData"), id),
  );
  // Skills registry (Settings → Skills). open/reveal only act on a path that
  // listSkills itself returns, so the renderer can't point them at arbitrary files.
  ipcMain.handle("skills:list", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) return [];
    return listSkills(project.path, homedir());
  });
  ipcMain.handle("skills:open", async (_event, projectId: string, skillPath: string, reveal: boolean) => {
    const project = await getProject(projectId);
    if (!project) return { opened: false, error: "Project not found." };
    const known = (await listSkills(project.path, homedir())).some((s) => s.path === skillPath);
    if (!known) return { opened: false, error: "Unknown skill." };
    if (reveal) {
      shell.showItemInFolder(skillPath);
      return { opened: true };
    }
    const err = await shell.openPath(skillPath);
    return err ? { opened: false, error: err } : { opened: true };
  });
  ipcMain.handle("skills:create", async (_event, projectId: string, name: string, description: string) => {
    const project = await getProject(projectId);
    if (!project) return { ok: false as const, error: "Project not found." };
    try {
      const { path } = await createProjectSkill(project.path, String(name ?? "").trim(), String(description ?? ""));
      return { ok: true as const, path };
    } catch (err) {
      if (err instanceof SkillCreateError) return { ok: false as const, error: err.message };
      throw err;
    }
  });
}
