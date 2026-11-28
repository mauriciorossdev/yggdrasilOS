// IPC for settings, editor and Claude pane preferences, automation and onboarding.
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { installAboutMenu } from "../aboutPanel.js";
import { type PermissionKind, getDesktopAutomationAdapter } from "../automation/index.js";
import { type AutomationSettings, loadAutomationSettings, saveAutomationSettings } from "../automationSettings.js";
import {
  type ClaudePaneSettings,
  isCavemanInstalled,
  loadClaudePaneSettings,
  readUserMcpServers,
  saveClaudePaneSettings,
} from "../claudePaneSettings.js";
import { CLI_CATALOG, detectClis } from "../cliDetect.js";
import { type EditorSettings, loadEditorSettings, saveEditorSettings } from "../editorSettings.js";
import { mt, resolveMainLanguage, setMainLanguage } from "../i18n.js";
import { detectOllama } from "../ollamaDetect.js";
import {
  type OnboardingSettings,
  hasExistingConfig,
  loadOnboardingSettings,
  saveOnboardingSettings,
  shouldAutoOpenOnboarding,
} from "../onboardingSettings.js";
import { readSettingsFile, updateSettingsFile } from "../settingsFile.js";
import { buildExportMarkdown, deepMerge, parseImportMarkdown, withGlobalProviders } from "../settingsTransfer.js";

export function registerPreferencesIpc(): void {
  ipcMain.handle(
    "settings:export",
    async (_event, workspaceRoot: string | null, includeSecrets: boolean): Promise<{ path: string } | null> => {
      const result = await dialog.showSaveDialog({
        title: mt("settings.exportTitle"),
        defaultPath: "yggdrasil-settings.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled || !result.filePath) return null;
      const desktop = await readSettingsFile(app.getPath("userData"));
      let gateway: Record<string, unknown> | null = null;
      if (workspaceRoot) {
        try {
          gateway = JSON.parse(await readFile(join(workspaceRoot, "yggdrasil.config.json"), "utf8")) as Record<string, unknown>;
        } catch {
          gateway = null;
        }
        let globalProviders: Record<string, unknown> | null = null;
        try {
          globalProviders = JSON.parse(await readFile(join(homedir(), ".yggdrasil", "providers.json"), "utf8")) as Record<string, unknown>;
        } catch {
          globalProviders = null;
        }
        gateway = withGlobalProviders(gateway, globalProviders);
      }
      await writeFile(
        result.filePath,
        buildExportMarkdown({ desktop, gateway, includeSecrets: Boolean(includeSecrets), exportedAt: new Date() }),
        { encoding: "utf8", mode: 0o600 },
      );
      return { path: result.filePath };
    },
  );
  // Desktop settings are merged here; the gateway part is returned for the
  // renderer to apply through config.patch (hot reload, per-id merge).
  ipcMain.handle(
    "settings:import",
    async (): Promise<{
      path: string;
      desktopKeys: string[];
      gateway: Record<string, unknown> | null;
      warnings: string[];
    } | null> => {
      const result = await dialog.showOpenDialog({
        title: mt("settings.importTitle"),
        properties: ["openFile"],
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const path = result.filePaths[0];
      const parsed = parseImportMarkdown(await readFile(path, "utf8"));
      const incoming = parsed.desktop;
      if (incoming) await updateSettingsFile(app.getPath("userData"), (existing) => deepMerge(existing, incoming));
      return { path, desktopKeys: incoming ? Object.keys(incoming) : [], gateway: parsed.gateway, warnings: parsed.warnings };
    },
  );
  // Code editor preferences: same persist-and-broadcast shape as the theme.
  ipcMain.handle("editorSettings:get", () => loadEditorSettings(app.getPath("userData")));
  ipcMain.handle("editorSettings:set", async (_event, settings: EditorSettings) => {
    const saved = await saveEditorSettings(app.getPath("userData"), settings);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("editorSettings:changed", saved);
    }
    return saved;
  });
  // Settings -> Agent CLIs -> Claude Code: applies to claude panes opened after saving.
  ipcMain.handle("claudePaneSettings:get", async () => ({
    settings: await loadClaudePaneSettings(app.getPath("userData")),
    cavemanInstalled: isCavemanInstalled(),
    userMcpServers: readUserMcpServers(),
  }));
  ipcMain.handle("claudePaneSettings:set", (_event, settings: ClaudePaneSettings) =>
    saveClaudePaneSettings(app.getPath("userData"), settings),
  );
  ipcMain.handle("onboarding:getState", async () => {
    const userData = app.getPath("userData");
    const settings = await loadOnboardingSettings(userData);
    return { settings, autoOpen: shouldAutoOpenOnboarding(settings, await hasExistingConfig(userData)) };
  });
  ipcMain.handle("onboarding:save", async (_event, settings: OnboardingSettings) => {
    const saved = await saveOnboardingSettings(app.getPath("userData"), settings);
    // Native dialogs and the app menu follow the UI language; rebuild the menu so it switches live.
    setMainLanguage(resolveMainLanguage(saved.language, app.getLocale()));
    installAboutMenu();
    return saved;
  });
  ipcMain.handle("onboarding:detectClis", () => detectClis());
  ipcMain.handle("onboarding:detectOllama", () => detectOllama());
  // Only the install links the wizard itself shows — not an open-any-URL channel.
  ipcMain.handle("onboarding:openExternal", async (_event, url: string) => {
    const allowed = new Set<string | undefined>([...CLI_CATALOG.map((c) => c.installUrl), "https://ollama.com/download"]);
    if (allowed.has(url)) await shell.openExternal(url);
  });
  // Automation settings (workflows-design.md §6.4/§8.2) — permission status
  // reads straight from the same adapter paneControlServer's /desktop/*
  // routes use (getDesktopAutomationAdapter is a stateless singleton), no
  // loopback HTTP hop needed since this IS the Electron main process.
  ipcMain.handle("automation:getPermissions", async () => getDesktopAutomationAdapter().getPermissions());
  ipcMain.handle("automation:requestPermission", async (_event, kind: PermissionKind) => {
    await getDesktopAutomationAdapter().requestPermission(kind);
  });
  ipcMain.handle("automation:getSettings", async (): Promise<AutomationSettings> => loadAutomationSettings(app.getPath("userData")));
  ipcMain.handle("automation:saveSettings", async (_event, settings: AutomationSettings) => {
    await saveAutomationSettings(app.getPath("userData"), settings);
  });
}
