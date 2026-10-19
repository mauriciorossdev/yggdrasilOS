import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";

/** Which notes/ files are open as tabs in the Documents view, and which is active. Content itself is never stored here — always re-read via fs.read. */
export type DocumentTabsLayout = { openPaths: string[]; activePath: string | null };

const EMPTY_LAYOUT: DocumentTabsLayout = { openPaths: [], activePath: null };

type LayoutFile = Record<string, DocumentTabsLayout>;

function layoutPath(): string {
  return join(app.getPath("userData"), "document-tabs.json");
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

export async function readDocumentTabs(projectId: string): Promise<DocumentTabsLayout> {
  const file = await readLayoutFile();
  return file[projectId] ?? EMPTY_LAYOUT;
}

export async function writeDocumentTabs(projectId: string, layout: DocumentTabsLayout): Promise<void> {
  const file = await readLayoutFile();
  file[projectId] = layout;
  await writeLayoutFile(file);
}
