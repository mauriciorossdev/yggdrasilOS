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

export function languageFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? "plaintext";
}
