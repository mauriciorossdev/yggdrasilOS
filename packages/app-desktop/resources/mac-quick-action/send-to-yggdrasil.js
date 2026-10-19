// JXA (JavaScript for Automation) script behind the "Enviar a Yggdrasil" Finder
// Quick Action. Invoked as: osascript -l JavaScript send-to-yggdrasil.js <path1> <path2> ...
// (the Quick Action passes the Finder selection as argv — see install.sh/README).
//
// Reads the desktop app's own project registry (same projects.json that backs
// the in-app project switcher — see packages/app-desktop/src/main/projects.ts),
// asks the user which project + destination folder, and copies the selected
// Finder items there.
ObjC.import("Foundation");

function readFile(path) {
  const str = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  return str ? str.js : null;
}

function findProjectsRegistry(home) {
  // Dev (unpackaged) and packaged builds can resolve Electron's userData dir
  // to a different folder name — try the known candidates, first match wins.
  const candidates = [
    home + "/Library/Application Support/@yggdrasil/app-desktop/projects.json",
    home + "/Library/Application Support/Yggdrasil/projects.json",
    home + "/Library/Application Support/Electron/projects.json",
  ];
  for (const path of candidates) {
    const raw = readFile(path);
    if (raw) return raw;
  }
  return null;
}

function appIcon() {
  const fm = $.NSFileManager.defaultManager;
  const candidates = [
    "/Applications/yggdrasil-desktop.app/Contents/Resources/icon.icns",
    "/Applications/Yggdrasil.app/Contents/Resources/icon.icns",
  ];
  for (const path of candidates) {
    if (fm.fileExistsAtPath(path)) return Path(path);
  }
  return null;
}

function run(argv) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;

  if (!argv || argv.length === 0) {
    app.displayAlert("Yggdrasil", { message: "No hay archivos seleccionados.", as: "critical" });
    return;
  }

  const home = $.NSHomeDirectory().js;
  const raw = findProjectsRegistry(home);
  if (!raw) {
    app.displayAlert("Yggdrasil", { message: "No encontré la lista de proyectos de Yggdrasil en este equipo.", as: "critical" });
    return;
  }

  let projects;
  try {
    projects = JSON.parse(raw);
  } catch (e) {
    app.displayAlert("Yggdrasil", { message: "projects.json inválido: " + e, as: "critical" });
    return;
  }
  if (!Array.isArray(projects) || projects.length === 0) {
    app.displayAlert("Yggdrasil", { message: "No hay proyectos registrados todavía." });
    return;
  }

  projects.sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));

  // Plain project names read better in the list — only fall back to
  // "name — path" for names that collide (e.g. two "Default Workspace").
  const nameCounts = {};
  for (const p of projects) nameCounts[p.name] = (nameCounts[p.name] || 0) + 1;
  const labels = projects.map((p) => (nameCounts[p.name] > 1 ? p.name + "  —  " + p.path : p.name));

  const icon = appIcon();
  const itemWord = argv.length === 1 ? "1 elemento" : argv.length + " elementos";

  const chosenLabels = app.chooseFromList(labels, {
    withPrompt: "Enviar " + itemWord + " a qué proyecto:",
    withTitle: "Yggdrasil",
    okButtonName: "Elegir",
    cancelButtonName: "Cancelar",
    ...(icon ? { withIcon: icon } : {}),
  });
  if (!chosenLabels) return; // user cancelled

  const project = projects[labels.indexOf(chosenLabels[0])];

  let destButton;
  try {
    const result = app.displayDialog("¿A dónde en “" + project.name + "”?", {
      buttons: ["Cancelar", "Raíz del proyecto", "Notes"],
      defaultButton: "Notes",
      cancelButton: "Cancelar",
      withTitle: "Yggdrasil",
      ...(icon ? { withIcon: icon } : {}),
    });
    destButton = result.buttonReturned;
  } catch (e) {
    return; // user cancelled
  }

  const destFolder = destButton === "Notes" ? project.path + "/notes" : project.path;

  const fm = $.NSFileManager.defaultManager;
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(destFolder, true, $.NSDictionary.dictionary, null);

  const copied = [];
  const failed = [];
  for (const srcPath of argv) {
    const fileName = srcPath.split("/").pop();
    let destPath = destFolder + "/" + fileName;

    // Don't silently overwrite an existing file with the same name.
    if (fm.fileExistsAtPath(destPath)) {
      const dot = fileName.lastIndexOf(".");
      const base = dot > 0 ? fileName.slice(0, dot) : fileName;
      const ext = dot > 0 ? fileName.slice(dot) : "";
      let n = 2;
      while (fm.fileExistsAtPath(destFolder + "/" + base + " " + n + ext)) n++;
      destPath = destFolder + "/" + base + " " + n + ext;
    }

    const ok = fm.copyItemAtPathToPathError(srcPath, destPath, null);
    if (ok) copied.push(destPath.split("/").pop());
    else failed.push(fileName);
  }

  let msg = copied.length ? "Copiado: " + copied.join(", ") : "";
  if (failed.length) msg += (msg ? "\n" : "") + "Falló: " + failed.join(", ");
  app.displayNotification(msg || "Sin cambios", { withTitle: "Yggdrasil", subtitle: project.name });
}
