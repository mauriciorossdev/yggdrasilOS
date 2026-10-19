import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";

/** Which complemento pestañas (MainTabs' extraTabs) were open, per project — same shape/persistence pattern as documentTabs.ts. Content itself is never stored here, just the list of open PluginRecord keys. */
export type PluginTabsLayout = { openKeys: string[] };

const EMPTY_LAYOUT: PluginTabsLayout = { openKeys: [] };

type LayoutFile = Record<string, PluginTabsLayout>;

function layoutPath(): string {
  return join(app.getPath("userData"), "plugin-tabs.json");
}

async function readLayoutFile(): Promise<LayoutFile> {
  try {
    const raw = await readFile(layoutPath(), "utf8");
    return JSON.parse(raw) as LayoutFile;
  } catch {
    return {};
  }
}

async function writeLayoutFile(file: LayoutFile): Promise<void> {
  await mkdir(dirname(layoutPath()), { recursive: true });
  await writeFile(layoutPath(), JSON.stringify(file, null, 2), "utf8");
}

export async function readPluginTabs(projectId: string): Promise<PluginTabsLayout> {
  const file = await readLayoutFile();
  return file[projectId] ?? EMPTY_LAYOUT;
}

export async function writePluginTabs(projectId: string, layout: PluginTabsLayout): Promise<void> {
  const file = await readLayoutFile();
  file[projectId] = layout;
  await writeLayoutFile(file);
}
