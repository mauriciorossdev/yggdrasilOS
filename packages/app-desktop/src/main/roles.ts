import { randomUUID } from "node:crypto";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

export type CustomRole = {
  id: string;
  label: string;
  summary?: string;
  systemPrompt: string;
};

/** desktop-settings.json also holds roles's custom list (nested under "customRoles") — see settingsFile.ts's shared write queue. */
export async function loadCustomRoles(userDataDir: string): Promise<CustomRole[]> {
  const raw = await readSettingsFile(userDataDir);
  return (raw as { customRoles?: CustomRole[] }).customRoles ?? [];
}

export async function saveCustomRole(
  userDataDir: string,
  role: { label: string; summary?: string; systemPrompt: string },
): Promise<CustomRole[]> {
  const newRole: CustomRole = { id: randomUUID(), ...role };
  let updated: CustomRole[] = [];
  await updateSettingsFile(userDataDir, (existing) => {
    const current = (existing as { customRoles?: CustomRole[] }).customRoles ?? [];
    updated = [...current, newRole];
    return { ...existing, customRoles: updated };
  });
  return updated;
}

export async function deleteCustomRole(userDataDir: string, id: string): Promise<CustomRole[]> {
  let updated: CustomRole[] = [];
  await updateSettingsFile(userDataDir, (existing) => {
    const current = (existing as { customRoles?: CustomRole[] }).customRoles ?? [];
    updated = current.filter((r) => r.id !== id);
    return { ...existing, customRoles: updated };
  });
  return updated;
}
