// IPC for files: the tree and search, office documents, clipboard, Documents and package scripts.
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { dialog, ipcMain, shell } from "electron";
import { readClipboardFilePaths, writeClipboardFilePaths } from "../clipboardFiles.js";
import { type DocumentTabsLayout, readDocumentTabs, writeDocumentTabs } from "../documentTabs.js";
import { importExternalPaths } from "../fileImport.js";
import { MAX_ASSET_BYTES, isImageName, sanitizeAssetName, uniqueAssetName } from "../noteAssets.js";
import {
  copyPathFor,
  createDeckFile,
  createDocFile,
  createSheetFile,
  loadDeck,
  loadDoc,
  loadSheetSnapshot,
  saveDeck,
  saveDoc,
  saveSheetSnapshot,
  setSheetBaseline,
} from "../officeFiles.js";
import { resolveTerminalPath } from "../pathResolve.js";
import { classifyPickedPaths } from "../pickedAttachments.js";
import { getProject } from "../projects.js";
import { runScriptInSystemTerminal } from "../scriptRunner.js";

export function registerFilesIpc(): void {
  ipcMain.handle(
    "scripts:runInTerminal",
    (_event, params: { cwd: string; packageManager: string; scriptName: string }) =>
      runScriptInSystemTerminal(params.cwd, params.packageManager, params.scriptName),
  );
  ipcMain.handle("documents:getLayout", (_event, projectId: string) => readDocumentTabs(projectId));
  ipcMain.handle("documents:saveLayout", (_event, projectId: string, layout: DocumentTabsLayout) =>
    writeDocumentTabs(projectId, layout),
  );
  ipcMain.handle(
    "files:importExternal",
    async (_event, projectId: string, destRelativePath: string, sourcePaths: string[]) => {
      const project = await getProject(projectId);
      if (!project) throw new Error("Unknown project");
      return importExternalPaths(project.path, destRelativePath, sourcePaths);
    },
  );
  ipcMain.handle("clipboard:readFilePaths", () => readClipboardFilePaths());
  // Absolute path of a project-relative one, confined to the project root: what
  // "send to terminal" writes into a pane and what "copy file" puts on the clipboard.
  const resolveInProject = async (projectId: string, relativePath: string): Promise<string> => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const root = resolve(project.path);
    const target = resolve(root, relativePath);
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("relativePath escapes the project root");
    return target;
  };
  ipcMain.handle("files:absolutePath", (_event, projectId: string, relativePath: string) =>
    resolveInProject(projectId, relativePath),
  );
  // In-app spreadsheet editor (workspace/SheetEditor.tsx): .xlsx ⇄ the editor's snapshot, confined to the project.
  ipcMain.handle("office:sheetLoad", async (_event, projectId: string, relativePath: string) =>
    loadSheetSnapshot(await resolveInProject(projectId, relativePath), basename(relativePath)),
  );
  ipcMain.handle("office:sheetSave", async (_event, projectId: string, relativePath: string, snapshot: unknown) =>
    saveSheetSnapshot(await resolveInProject(projectId, relativePath), snapshot as Parameters<typeof saveSheetSnapshot>[1]),
  );
  ipcMain.handle("office:sheetBaseline", async (_event, projectId: string, relativePath: string, snapshot: unknown) =>
    setSheetBaseline(await resolveInProject(projectId, relativePath), snapshot as Parameters<typeof saveSheetSnapshot>[1]),
  );
  // "Save a copy" for a file the editor can't round-trip without loss: returns the copy's project-relative path.
  ipcMain.handle("office:sheetSaveCopy", async (_event, projectId: string, relativePath: string, snapshot: unknown) => {
    const copy = await copyPathFor(await resolveInProject(projectId, relativePath));
    await saveSheetSnapshot(copy, snapshot as Parameters<typeof saveSheetSnapshot>[1]);
    const project = await getProject(projectId);
    return relative(resolve(project!.path), copy);
  });
  // Word documents (workspace/DocEditor.tsx).
  ipcMain.handle("office:docLoad", async (_event, projectId: string, relativePath: string) =>
    loadDoc(await resolveInProject(projectId, relativePath)),
  );
  ipcMain.handle("office:docSave", async (_event, projectId: string, relativePath: string, model: unknown) =>
    saveDoc(await resolveInProject(projectId, relativePath), model as Parameters<typeof saveDoc>[1]),
  );
  ipcMain.handle("office:docSaveCopy", async (_event, projectId: string, relativePath: string, model: unknown) => {
    const copy = await copyPathFor(await resolveInProject(projectId, relativePath));
    await saveDoc(copy, model as Parameters<typeof saveDoc>[1]);
    const project = await getProject(projectId);
    return relative(resolve(project!.path), copy);
  });
  ipcMain.handle("office:docCreate", async (_event, projectId: string, relativePath: string, model: unknown) =>
    createDocFile(await resolveInProject(projectId, relativePath), model as Parameters<typeof createDocFile>[1]),
  );
  // PowerPoint presentations (workspace/DeckEditor.tsx).
  ipcMain.handle("office:deckLoad", async (_event, projectId: string, relativePath: string) =>
    loadDeck(await resolveInProject(projectId, relativePath)),
  );
  ipcMain.handle("office:deckSave", async (_event, projectId: string, relativePath: string, deck: unknown) =>
    saveDeck(await resolveInProject(projectId, relativePath), deck as Parameters<typeof saveDeck>[1]),
  );
  ipcMain.handle("office:deckSaveCopy", async (_event, projectId: string, relativePath: string, deck: unknown) => {
    const copy = await copyPathFor(await resolveInProject(projectId, relativePath));
    await saveDeck(copy, deck as Parameters<typeof saveDeck>[1]);
    const project = await getProject(projectId);
    return relative(resolve(project!.path), copy);
  });
  ipcMain.handle("office:deckCreate", async (_event, projectId: string, relativePath: string, deck: unknown) =>
    createDeckFile(await resolveInProject(projectId, relativePath), deck as Parameters<typeof createDeckFile>[1]),
  );
  ipcMain.handle(
    "office:sheetCreate",
    async (_event, projectId: string, relativePath: string, rows?: Array<Array<string | number | boolean | null>>) =>
      createSheetFile(await resolveInProject(projectId, relativePath), rows ?? []),
  );
  // An image pasted, dropped or picked into a note: stored in an `assets` folder next to the note, under a safe
  // name that doesn't collide with what is already there. Returns the address to write in the markdown
  // (`assets/name.png`, relative to the note).
  ipcMain.handle(
    "files:saveAsset",
    async (_event, projectId: string, noteRelativePath: string, fileName: string, data: Uint8Array) => {
      const name = sanitizeAssetName(fileName);
      if (!isImageName(name)) throw new Error("Solo se pueden guardar imágenes (png, jpg, gif, webp, svg, bmp, avif).");
      if (data.byteLength > MAX_ASSET_BYTES) throw new Error("La imagen pesa más de 25 MB.");
      const noteDir = noteRelativePath.includes("/") ? noteRelativePath.slice(0, noteRelativePath.lastIndexOf("/")) : "";
      const assetsDir = await resolveInProject(projectId, noteDir ? `${noteDir}/assets` : "assets");
      await mkdir(assetsDir, { recursive: true });
      const unique = uniqueAssetName(name, await readdir(assetsDir));
      await writeFile(resolve(assetsDir, unique), Buffer.from(data));
      return { src: `assets/${unique}` };
    },
  );
  ipcMain.handle("clipboard:writeFilePaths", async (_event, projectId: string, relativePaths: string[]) => {
    const absolute = await Promise.all(relativePaths.map((p) => resolveInProject(projectId, p)));
    return writeClipboardFilePaths(absolute);
  });
  // The chat's "attach" button: a native picker that opens on the project. Attachments are
  // project-relative (the gateway reads them from there), so anything chosen outside it
  // is reported back instead of being silently dropped.
  ipcMain.handle("files:pickToAttach", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const root = resolve(project.path);
    const result = await dialog.showOpenDialog({
      defaultPath: root,
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    if (result.canceled) return { attachments: [], rejected: [] };
    return classifyPickedPaths(root, result.filePaths, async (path) => {
      const info = await stat(path).catch(() => null);
      return info ? (info.isDirectory() ? "directory" : "file") : null;
    });
  });
  // The reliable way to import files: a real OS picker always hands back
  // genuine absolute paths, no matter what quirks a given file has on the
  // clipboard (see clipboardFiles.ts's file-ID-URL doc comment) or whether
  // it's convenient to drag right now.
  ipcMain.handle("files:pickToImport", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "openDirectory", "multiSelections", "treatPackageAsDirectory"],
    });
    return result.canceled ? [] : result.filePaths;
  });
  // For a file type FileViewer.tsx can't render inline (a .docx, a video,
  // etc.) — hands off to the OS's own default app instead of just failing.
  ipcMain.handle("files:openExternal", async (_event, projectId: string, relativePath: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const resolvedRoot = resolve(project.path);
    const target = resolve(resolvedRoot, relativePath);
    const rel = relative(resolvedRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("relativePath escapes the project root");
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
  });
  // Terminal path links (renderer terminal/pathLinkProvider.ts). Paths come
  // from untrusted terminal output, so this only stats them, and anything
  // outside the project is only ever *revealed* (selected in Finder/Explorer),
  // never opened — opening could run a script or an .app an agent printed.
  ipcMain.handle("paths:resolve", async (_event, projectId: string, raw: string, cwd: string | null) => {
    if (typeof raw !== "string" || raw.length > 4096) return null;
    const project = await getProject(projectId);
    return resolveTerminalPath(raw, typeof cwd === "string" && isAbsolute(cwd) ? cwd : null, project?.path ?? null);
  });
  ipcMain.handle("paths:reveal", async (_event, abs: string) => {
    if (typeof abs !== "string" || !isAbsolute(abs)) return { opened: false, error: "Not an absolute path." };
    const info = await stat(abs).catch(() => null);
    if (!info) return { opened: false, error: "Path not found." };
    shell.showItemInFolder(resolve(abs));
    return { opened: true };
  });
}
