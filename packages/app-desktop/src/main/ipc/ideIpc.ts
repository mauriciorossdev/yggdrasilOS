// IPC for the external IDE integration.
import { isAbsolute, join, relative, resolve } from "node:path";
import { app, dialog, ipcMain, shell } from "electron";
import { locateBlender, openInBlender } from "../blender.js";
import { mt } from "../i18n.js";
import {
  type DetectedIde,
  IDE_CATALOG,
  type IdeSettings,
  detectInstalledIdes,
  loadIdeSettings,
  openProjectInIde,
  saveIdeSettings,
} from "../ideSettings.js";
import { getProject } from "../projects.js";

export function registerIdeIpc(): void {
  ipcMain.handle("ide:listCatalog", () => IDE_CATALOG.map(({ id, label }) => ({ id, label })));
  ipcMain.handle("ide:detectInstalled", async (): Promise<DetectedIde[]> => detectInstalledIdes());
  ipcMain.handle("ide:getSettings", async (): Promise<IdeSettings> => loadIdeSettings(app.getPath("userData")));
  ipcMain.handle("ide:saveSettings", async (_event, settings: IdeSettings) => {
    await saveIdeSettings(app.getPath("userData"), settings);
  });
  // Package bundles (.app on macOS) are directories but should still be
  // pickable as a single "file" here — showOpenDialog's default (not
  // treating them as navigable directories) already does the right thing.
  ipcMain.handle("ide:pickCustomPath", async () => {
    const result = await dialog.showOpenDialog({ title: mt("ide.pickCustom"), properties: ["openFile"] });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!;
  });
  ipcMain.handle("ide:openProject", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) return { opened: false, error: "Project not found." };
    const settings = await loadIdeSettings(app.getPath("userData"));
    return openProjectInIde(project.path, settings);
  });
  ipcMain.handle("ide:openPath", async (_event, projectId: string, relativePath: string) => {
    const project = await getProject(projectId);
    if (!project) return { opened: false, error: "Project not found." };
    const settings = await loadIdeSettings(app.getPath("userData"));
    return openProjectInIde(join(project.path, relativePath), settings);
  });
  // "Show in file explorer": folders open themselves, files open their
  // containing folder with the file pre-selected. Confined to the project root.
  ipcMain.handle("ide:revealPath", async (_event, projectId: string, relativePath: string, isDir: boolean) => {
    const project = await getProject(projectId);
    if (!project) return { opened: false, error: "Project not found." };
    const root = resolve(project.path);
    const target = resolve(root, relativePath);
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) return { opened: false, error: "Path is outside the project." };
    if (isDir) {
      const err = await shell.openPath(target);
      return err ? { opened: false, error: err } : { opened: true };
    }
    shell.showItemInFolder(target);
    return { opened: true };
  });
  ipcMain.handle("ide:openInBlender", async (_event, projectId: string, relativePath: string) => {
    const project = await getProject(projectId);
    if (!project) return { opened: false, error: "Project not found." };
    const root = resolve(project.path);
    const target = resolve(root, relativePath);
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) return { opened: false, error: "Path is outside the project." };
    const settings = await loadIdeSettings(app.getPath("userData"));
    return openInBlender(target, settings);
  });
  ipcMain.handle("ide:detectBlender", async () => {
    const settings = await loadIdeSettings(app.getPath("userData"));
    return locateBlender(settings);
  });
}
