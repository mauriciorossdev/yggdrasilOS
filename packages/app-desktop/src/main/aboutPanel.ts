import { join, resolve } from "node:path";
import { app, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { mt } from "./i18n.js";

/** Where THIRD_PARTY_NOTICES.txt lives: next to the app's resources once packaged (see electron-builder.yml extraResources), the repo's generated .md in dev. */
function licensesPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "THIRD_PARTY_NOTICES.txt")
    : resolve(app.getAppPath(), "..", "..", "THIRD_PARTY_NOTICES.md");
}

async function openLicenses(): Promise<void> {
  const error = await shell.openPath(licensesPath());
  if (error) dialog.showErrorBox(mt("about.licenses"), mt("about.licensesError", { path: licensesPath(), error }));
}

/**
 * macOS gets its "About Yggdrasil" item for free (Electron's default appMenu
 * role wires it to `app.showAboutPanel()` automatically) — `setAboutPanelOptions`
 * just supplies the version text it shows. `app.showAboutPanel()` isn't
 * available on Windows, so that platform needs an explicit menu item and a
 * plain dialog instead; Linux gets the native panel same as mac.
 * Safe to call again when the UI language changes: it rebuilds the menu.
 */
export function installAboutMenu(): void {
  app.setAboutPanelOptions({
    applicationName: "Yggdrasil",
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    credits: mt("about.credits", { path: licensesPath() }),
  });

  if (process.platform !== "win32") return;

  const showAboutDialog = (): void => {
    void dialog.showMessageBox({
      type: "info",
      title: mt("about.menu"),
      message: "Yggdrasil",
      detail: mt("about.version", { version: app.getVersion() }),
    });
  };

  const template: MenuItemConstructorOptions[] = [
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: mt("about.menu"), click: showAboutDialog },
        { label: mt("about.licenses"), click: () => void openLicenses() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
