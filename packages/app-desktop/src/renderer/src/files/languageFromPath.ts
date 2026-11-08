const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  go: "go",
  rs: "rust",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  xml: "xml",
  toml: "ini",
  ini: "ini",
};

/** The fields of Monaco's language registry used to resolve a file (monaco.languages.ILanguageExtensionPoint). */
export type LanguageInfo = { id: string; extensions?: string[]; filenames?: string[] };

let byExtension = new Map<string, string>();
let byFilename = new Map<string, string>();

/**
 * Adds Monaco's language registry (java, c/cpp, php, dockerfile...) behind the table above. It's handed
 * in by monacoSetup.ts rather than imported, so this file doesn't pull the whole editor into its importers.
 */
export function setLanguageCatalog(languages: LanguageInfo[]): void {
  const extensions = new Map<string, string>();
  const filenames = new Map<string, string>();
  for (const language of languages) {
    for (const ext of language.extensions ?? []) {
      const key = ext.replace(/^\./, "").toLowerCase();
      if (!extensions.has(key)) extensions.set(key, language.id);
    }
    for (const name of language.filenames ?? []) {
      const key = name.toLowerCase();
      if (!filenames.has(key)) filenames.set(key, language.id);
    }
  }
  byExtension = extensions;
  byFilename = filenames;
}

export function languageFromPath(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1).toLowerCase();
  if (/^\.env(\..+)?$/.test(base)) return "ini";
  if (/^dockerfile(\..+)?$/.test(base)) return "dockerfile";
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot + 1);
  return (ext && EXTENSION_TO_LANGUAGE[ext]) || byFilename.get(base) || (ext && byExtension.get(ext)) || "plaintext";
}
