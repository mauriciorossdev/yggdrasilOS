import { randomUUID } from "node:crypto";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

export type CustomFlowTemplate = {
  id: string;
  label: string;
  summary?: string;
  prompt: string;
};

/**
 * desktop-settings.json also holds Agent Flow's custom role-template list
 * (nested under "customFlowTemplates") — see settingsFile.ts's shared write
 * queue. Kept separate from main/roles.ts's "customRoles": that list is for
 * AgentManager's standalone-agent systemPrompt (no team-collaboration
 * language), this one is for AgentTemplatePicker's team-node initial prompt
 * — same shape by coincidence, different audience, never merged.
 */
export async function loadCustomFlowTemplates(userDataDir: string): Promise<CustomFlowTemplate[]> {
  const raw = await readSettingsFile(userDataDir);
  return (raw as { customFlowTemplates?: CustomFlowTemplate[] }).customFlowTemplates ?? [];
}

export async function saveCustomFlowTemplate(
  userDataDir: string,
  template: { label: string; summary?: string; prompt: string },
): Promise<CustomFlowTemplate[]> {
  const newTemplate: CustomFlowTemplate = { id: randomUUID(), ...template };
  let updated: CustomFlowTemplate[] = [];
  await updateSettingsFile(userDataDir, (existing) => {
    const current = (existing as { customFlowTemplates?: CustomFlowTemplate[] }).customFlowTemplates ?? [];
    updated = [...current, newTemplate];
    return { ...existing, customFlowTemplates: updated };
  });
  return updated;
}

export async function deleteCustomFlowTemplate(userDataDir: string, id: string): Promise<CustomFlowTemplate[]> {
  let updated: CustomFlowTemplate[] = [];
  await updateSettingsFile(userDataDir, (existing) => {
    const current = (existing as { customFlowTemplates?: CustomFlowTemplate[] }).customFlowTemplates ?? [];
    updated = current.filter((t) => t.id !== id);
    return { ...existing, customFlowTemplates: updated };
  });
  return updated;
}
