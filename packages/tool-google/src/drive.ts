import { readFile } from "node:fs/promises";
import { resolveWithinNotes } from "@yggdrasil/tool-documents";
import { googleFetch } from "./google-api.js";
import {
  getCachedNotesFolderId,
  getDriveRecord,
  setCachedNotesFolderId,
  setDriveRecord,
} from "./drive-store.js";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const NOTES_FOLDER_NAME = "Yggdrasil Notes";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const BOUNDARY = "yggdrasil-drive-upload-boundary";

const MIME_BY_EXT: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  csv: "text/csv",
  html: "text/html",
};

function mimeTypeFor(relativePath: string): string {
  const ext = relativePath.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "text/plain";
}

/**
 * Finds this workspace's "Yggdrasil Notes" Drive folder, creating it on
 * first use. Cached in drive-store.ts after the first lookup/create so
 * every subsequent upload skips the search — `drive.file` scope only lets
 * this app see files/folders it created itself, so there's no risk of two
 * different tools colliding on the same folder name.
 */
export async function findOrCreateNotesFolder(workspaceRoot: string, accessToken: string): Promise<string> {
  const cached = await getCachedNotesFolderId(workspaceRoot);
  if (cached) return cached;

  const query = new URLSearchParams({
    q: `name='${NOTES_FOLDER_NAME}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`,
    fields: "files(id,name)",
  });
  const found = (await googleFetch(`${DRIVE_FILES_URL}?${query.toString()}`, accessToken)) as {
    files?: Array<{ id: string }>;
  };
  const existingId = found.files?.[0]?.id;
  if (existingId) {
    await setCachedNotesFolderId(workspaceRoot, existingId);
    return existingId;
  }

  const created = (await googleFetch(DRIVE_FILES_URL, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: NOTES_FOLDER_NAME, mimeType: FOLDER_MIME_TYPE }),
  })) as { id: string };
  await setCachedNotesFolderId(workspaceRoot, created.id);
  return created.id;
}

function buildMultipartBody(metadata: Record<string, unknown>, content: string, mimeType: string): string {
  return (
    `--${BOUNDARY}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${BOUNDARY}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${BOUNDARY}--`
  );
}

/**
 * Creates a new Drive file, or (when `existingFileId` is given) overwrites
 * the content of one already uploaded — so re-sharing an edited note
 * updates the same Drive file instead of piling up duplicates.
 */
async function uploadFile(
  accessToken: string,
  params: { name: string; mimeType: string; content: string; folderId: string; existingFileId?: string },
): Promise<{ id: string; webViewLink: string }> {
  const metadata: Record<string, unknown> = { name: params.name };
  if (!params.existingFileId) metadata.parents = [params.folderId];

  const body = buildMultipartBody(metadata, params.content, params.mimeType);
  const url = params.existingFileId
    ? `${DRIVE_UPLOAD_URL}/${params.existingFileId}?uploadType=multipart&fields=id,webViewLink`
    : `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`;

  return (await googleFetch(url, accessToken, {
    method: params.existingFileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${BOUNDARY}` },
    body,
  })) as { id: string; webViewLink: string };
}

async function makeAnyoneWithLinkReader(accessToken: string, fileId: string): Promise<void> {
  await googleFetch(`${DRIVE_FILES_URL}/${fileId}/permissions`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
}

export type UploadNoteResult = { fileId: string; webViewLink: string };

/**
 * Core function behind both the `drive_upload_document` agent tool and the
 * `documents.uploadToDrive` gateway method (see index.ts) — one
 * implementation, two entry points, same pattern as this package's own
 * authUrl/completeAuth wrapping plain functions.
 *
 * Every upload is made shareable ("anyone with the link can view") —
 * confirmed default with the user; there is no private-upload mode in v1.
 */
export async function uploadNoteToDrive(
  workspaceRoot: string,
  accessToken: string,
  relativePath: string,
): Promise<UploadNoteResult> {
  // Reuses tool-documents' own path guard rather than re-implementing
  // notes/-scoping a second time — this tool has no business touching
  // anything outside notes/.
  const absolutePath = resolveWithinNotes({ workspaceRoot }, "drive_upload_document", relativePath);
  const content = await readFile(absolutePath, "utf8");

  const folderId = await findOrCreateNotesFolder(workspaceRoot, accessToken);
  const existing = await getDriveRecord(workspaceRoot, relativePath);
  const name = relativePath.split("/").pop() ?? relativePath;

  const result = await uploadFile(accessToken, {
    name,
    mimeType: mimeTypeFor(relativePath),
    content,
    folderId,
    existingFileId: existing?.fileId,
  });

  // Permission only needs to be set once — re-uploading content to the same
  // fileId doesn't reset its sharing settings.
  if (!existing) await makeAnyoneWithLinkReader(accessToken, result.id);

  await setDriveRecord(workspaceRoot, relativePath, {
    fileId: result.id,
    webViewLink: result.webViewLink,
    uploadedAt: Date.now(),
  });

  return { fileId: result.id, webViewLink: result.webViewLink };
}
