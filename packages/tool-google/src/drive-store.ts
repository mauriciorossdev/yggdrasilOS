import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type DriveUploadRecord = {
  fileId: string;
  webViewLink: string;
  uploadedAt: number;
};

type DriveStore = {
  /** Cached id of the "Yggdrasil Notes" Drive folder, so it's only searched/created once per workspace. */
  notesFolderId?: string;
  /** Keyed by the note's path relative to notes/ — lets a re-upload update the same Drive file instead of duplicating it. */
  notes?: Record<string, DriveUploadRecord>;
};

/**
 * Lives outside notes/ (same reasoning as tool-cli-delegate's
 * cli-sessions.json) — this is the tool's own bookkeeping, not a note a
 * human authored, so it shouldn't show up in the Documents file tree.
 */
function storePath(workspaceRoot: string): string {
  return join(workspaceRoot, ".yggdrasil", "drive-links.json");
}

async function readStore(workspaceRoot: string): Promise<DriveStore> {
  try {
    const raw = await readFile(storePath(workspaceRoot), "utf8");
    return JSON.parse(raw) as DriveStore;
  } catch {
    return {};
  }
}

async function writeStore(workspaceRoot: string, store: DriveStore): Promise<void> {
  await mkdir(join(workspaceRoot, ".yggdrasil"), { recursive: true });
  await writeFile(storePath(workspaceRoot), JSON.stringify(store, null, 2), "utf8");
}

export async function getCachedNotesFolderId(workspaceRoot: string): Promise<string | undefined> {
  return (await readStore(workspaceRoot)).notesFolderId;
}

export async function setCachedNotesFolderId(workspaceRoot: string, folderId: string): Promise<void> {
  const store = await readStore(workspaceRoot);
  store.notesFolderId = folderId;
  await writeStore(workspaceRoot, store);
}

export async function getDriveRecord(workspaceRoot: string, relativePath: string): Promise<DriveUploadRecord | undefined> {
  return (await readStore(workspaceRoot)).notes?.[relativePath];
}

export async function setDriveRecord(
  workspaceRoot: string,
  relativePath: string,
  record: DriveUploadRecord,
): Promise<void> {
  const store = await readStore(workspaceRoot);
  store.notes = { ...store.notes, [relativePath]: record };
  await writeStore(workspaceRoot, store);
}
