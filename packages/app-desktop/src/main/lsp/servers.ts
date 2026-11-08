import { delimiter, join } from "node:path";

/** How to reach a server. Node scripts run under Electron's own Node, so no Node install is needed. */
export type LspLaunch =
  | { kind: "script"; script: string; args: string[] }
  | { kind: "executable"; command: string; args: string[] }
  | { kind: "tcp"; host: "127.0.0.1"; port: number };

export type ResolvedServer = {
  launch: LspLaunch;
  /** LSP initializationOptions. */
  initializationOptions?: unknown;
  /** Answers to workspace/configuration requests, and the payload of didChangeConfiguration. */
  settings?: unknown;
};

export type ServerContext = {
  root: string;
  trusted: boolean;
  exists: (path: string) => boolean;
  /** A file inside a package this app ships; null if missing. */
  bundled: (specifier: string) => string | null;
  /** An executable on the PATH; null if missing. */
  onPath: (command: string) => string | null;
};

export type ServerSpec = {
  id: string;
  /** Monaco language ids it handles. */
  languages: string[];
  /** Whether it runs code from the project, so it can't start until the user trusts the project. */
  runsProjectCode: boolean;
  /** Whether it applies to this project at all; a server that doesn't is never offered. */
  appliesTo?: (ctx: ServerContext) => boolean;
  resolve: (ctx: ServerContext) => ResolvedServer | null;
  /** What to tell the user when it can't be found. */
  installHint?: string;
};

export type ServerStatus = "available" | "missing" | "needsTrust" | "notApplicable";

const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
];

function resolveTypescript(ctx: ServerContext): ResolvedServer | null {
  const script = ctx.bundled("typescript-language-server/lib/cli.mjs");
  const bundledTs = ctx.bundled("typescript-lsp/lib/tsserver.js");
  if (!script || !bundledTs) return null;
  // The project's own compiler is code from the project, so it needs trust; it also matches
  // the version the project builds with. The bundled one always works.
  const projectTs = join(ctx.root, "node_modules", "typescript", "lib", "tsserver.js");
  const tsserver = ctx.trusted && ctx.exists(projectTs) ? projectTs : bundledTs;
  return {
    launch: { kind: "script", script, args: ["--stdio"] },
    initializationOptions: {
      hostInfo: "yggdrasil",
      tsserver: { path: tsserver },
      // Type acquisition downloads packages from npm just because a file was opened.
      disableAutomaticTypingAcquisition: true,
      preferences: { includeCompletionsForModuleExports: true, includeCompletionsWithInsertText: true },
    },
  };
}

function resolveEslint(ctx: ServerContext): ResolvedServer | null {
  const script = ctx.bundled("vscode-langservers-extracted/lib/eslint-language-server/eslintServer.js");
  if (!script) return null;
  return {
    launch: { kind: "script", script, args: ["--stdio"] },
    settings: {
      validate: "on",
      packageManager: "npm",
      useESLintClass: true,
      rulesCustomizations: [],
      experimental: { useFlatConfig: false },
      codeAction: {
        disableRuleComment: { enable: true, location: "separateLine" },
        showDocumentation: { enable: false },
      },
      codeActionOnSave: { enable: false, mode: "all" },
      format: false,
      quiet: false,
      onIgnoredFiles: "off",
      options: {},
      run: "onType",
      problems: { shortenToSingleLine: false },
      nodePath: null,
      workingDirectory: { mode: "auto" },
      workspaceFolder: { uri: "", name: "" },
    },
  };
}

function resolveExecutable(command: string, args: string[]): (ctx: ServerContext) => ResolvedServer | null {
  return (ctx) => {
    const path = ctx.onPath(command);
    return path ? { launch: { kind: "executable", command: path, args } } : null;
  };
}

/** Godot's default "Remote Port" for its built-in language server. */
export const GODOT_LSP_PORT = 6005;

export const LSP_SERVERS: ServerSpec[] = [
  { id: "typescript", languages: ["typescript", "javascript"], runsProjectCode: false, resolve: resolveTypescript },
  {
    id: "eslint",
    languages: ["typescript", "javascript"],
    runsProjectCode: true,
    appliesTo: (ctx) => ESLINT_CONFIGS.some((name) => ctx.exists(join(ctx.root, name))),
    resolve: resolveEslint,
  },
  {
    id: "pyright",
    languages: ["python"],
    runsProjectCode: false,
    resolve: (ctx) => {
      const script = ctx.bundled("pyright/langserver.index.js");
      return script ? { launch: { kind: "script", script, args: ["--stdio"] } } : null;
    },
  },
  { id: "ruff", languages: ["python"], runsProjectCode: false, resolve: resolveExecutable("ruff", ["server"]), installHint: "pip install ruff" },
  // `go list` can run the project's build tooling, and rust-analyzer runs build scripts and proc macros.
  { id: "gopls", languages: ["go"], runsProjectCode: true, resolve: resolveExecutable("gopls", []), installHint: "go install golang.org/x/tools/gopls@latest" },
  { id: "rust-analyzer", languages: ["rust"], runsProjectCode: true, resolve: resolveExecutable("rust-analyzer", []), installHint: "rustup component add rust-analyzer" },
  {
    id: "godot",
    languages: ["gdscript"],
    runsProjectCode: false,
    appliesTo: (ctx) => ctx.exists(join(ctx.root, "project.godot")),
    resolve: () => ({ launch: { kind: "tcp", host: "127.0.0.1", port: GODOT_LSP_PORT } }),
  },
];

export function serverStatus(spec: ServerSpec, ctx: ServerContext): ServerStatus {
  if (spec.appliesTo && !spec.appliesTo(ctx)) return "notApplicable";
  if (spec.runsProjectCode && !ctx.trusted) return "needsTrust";
  return spec.resolve(ctx) ? "available" : "missing";
}

/** The servers to start for a language in this project. */
export function serversForLanguage(language: string, ctx: ServerContext): ServerSpec[] {
  return LSP_SERVERS.filter((spec) => spec.languages.includes(language) && serverStatus(spec, ctx) === "available");
}

/**
 * Finds an executable on the PATH. On Windows only real binaries count: .cmd/.bat shims would need
 * a shell, and these paths and arguments shouldn't go through one.
 */
export function findOnPath(
  command: string,
  exists: (path: string) => boolean,
  path = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
): string | null {
  const separator = platform === "win32" ? ";" : delimiter;
  const exts = platform === "win32" ? [".exe", ".com"] : [""];
  for (const dir of path.split(separator).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}
