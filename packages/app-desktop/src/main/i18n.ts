/**
 * UI strings of the main process (native dialogs and the app menu). The renderer
 * has its own dictionaries (renderer/src/i18n); this is a small separate copy
 * because the main process can't import renderer code. The language comes from
 * the same saved setting (OnboardingSettings.language), falling back to the OS locale.
 */
export type MainLanguage = "en" | "es";

const en = {
  "about.menu": "About Yggdrasil",
  "about.licenses": "Open source licenses",
  "about.version": "Version {version}",
  "about.credits": "Open source licenses: {path}",
  "about.licensesError": "Could not open {path}\n\n{error}",
  "project.openFailed": "Could not open project",
  "project.createTitle": "Create New Project",
  "project.createButton": "Create Project",
  "project.cloneTitle": "Clone \"{name}\" to…",
  "project.cloneButton": "Clone Project",
  "app.startFailed": "Yggdrasil failed to start",
  "app.seeLog": "See {path} for details.",
  "whisper.pickBinary": "Select whisper-server binary",
  "settings.exportTitle": "Export settings",
  "settings.importTitle": "Import settings",
  "ide.pickCustom": "Select IDE executable or app",
} as const;

export type MainMessageKey = keyof typeof en;

const es: Record<MainMessageKey, string> = {
  "about.menu": "Acerca de Yggdrasil",
  "about.licenses": "Licencias de código abierto",
  "about.version": "Versión {version}",
  "about.credits": "Licencias de código abierto: {path}",
  "about.licensesError": "No se pudo abrir {path}\n\n{error}",
  "project.openFailed": "No se pudo abrir el proyecto",
  "project.createTitle": "Crear proyecto nuevo",
  "project.createButton": "Crear proyecto",
  "project.cloneTitle": "Clonar \"{name}\" en…",
  "project.cloneButton": "Clonar proyecto",
  "app.startFailed": "Yggdrasil no pudo iniciarse",
  "app.seeLog": "Consulta {path} para ver los detalles.",
  "whisper.pickBinary": "Elige el binario de whisper-server",
  "settings.exportTitle": "Exportar ajustes",
  "settings.importTitle": "Importar ajustes",
  "ide.pickCustom": "Elige el ejecutable o la app del IDE",
};

const dictionaries: Record<MainLanguage, Record<MainMessageKey, string>> = { en, es };

/** The saved choice if supported, otherwise the OS locale's language, otherwise English. */
export function resolveMainLanguage(saved: string | null | undefined, systemLocale: string | null | undefined): MainLanguage {
  if (saved === "en" || saved === "es") return saved;
  const base = (systemLocale ?? "").toLowerCase().split(/[-_]/)[0];
  return base === "es" ? "es" : "en";
}

let current: MainLanguage = "en";

export function getMainLanguage(): MainLanguage {
  return current;
}

export function setMainLanguage(language: MainLanguage): void {
  current = language;
}

/** `{name}` placeholders are replaced from `vars`; unknown ones are left as-is. */
export function mt(key: MainMessageKey, vars?: Record<string, string | number>): string {
  const template = dictionaries[current][key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
