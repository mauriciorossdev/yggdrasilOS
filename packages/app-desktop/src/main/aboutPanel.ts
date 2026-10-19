import { app, dialog, Menu, type MenuItemConstructorOptions } from "electron";

/**
 * macOS gets its "About Yggdrasil" item for free (Electron's default appMenu
 * role wires it to `app.showAboutPanel()` automatically) — `setAboutPanelOptions`
 * just supplies the version text it shows. `app.showAboutPanel()` isn't
 * available on Windows, so that platform needs an explicit menu item and a
 * plain dialog instead; Linux gets the native panel same as mac.
 */
export function installAboutMenu(): void {
  app.setAboutPanelOptions({
    applicationName: "Yggdrasil",
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
  });

  if (process.platform !== "win32") return;

  const showAboutDialog = (): void => {
    void dialog.showMessageBox({
      type: "info",
      title: "About Yggdrasil",
      message: "Yggdrasil",
      detail: `Version ${app.getVersion()}`,
    });
  };

  const template: MenuItemConstructorOptions[] = [
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    { role: "help", submenu: [{ label: "About Yggdrasil", click: showAboutDialog }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
