import { exec as execCb } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ContextProvider, ContextBlock, ContextProviderContext } from "@yggdrasil/context-sdk";
import { definePlugin } from "@yggdrasil/sdk";

const exec = promisify(execCb);

async function run(cmd: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await exec(cmd, { cwd, timeout: 3000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function detectLanguages(root: string): Promise<string[]> {
  const langs: string[] = [];
  try {
    const entries = await readdir(root);
    if (entries.includes("tsconfig.json") || entries.includes("tsconfig.base.json")) langs.push("TypeScript");
    if (entries.includes("package.json")) langs.push("JavaScript/Node");
    if (entries.includes("go.mod")) langs.push("Go");
    if (entries.includes("Cargo.toml")) langs.push("Rust");
    if (entries.includes("requirements.txt") || entries.includes("pyproject.toml")) langs.push("Python");
  } catch {
    // ignore
  }
  return langs;
}

async function detectPackageManager(root: string): Promise<string> {
  try {
    const entries = await readdir(root);
    if (entries.includes("pnpm-lock.yaml") || entries.includes("pnpm-workspace.yaml")) return "pnpm";
    if (entries.includes("yarn.lock")) return "yarn";
    if (entries.includes("bun.lockb")) return "bun";
    if (entries.includes("package-lock.json")) return "npm";
  } catch {
    // ignore
  }
  return "unknown";
}

async function getTopLevelFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .slice(0, 20);
  } catch {
    return [];
  }
}

async function getProjectName(root: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    return pkg.name ?? root.split("/").pop() ?? "unknown";
  } catch {
    return root.split("/").pop() ?? "unknown";
  }
}

export const projectContextProvider: ContextProvider = {
  id: "project-context",
  label: "Project Context",
  priority: 30,

  async assemble(ctx: ContextProviderContext): Promise<ContextBlock[]> {
    const root = ctx.workspaceRoot;

    const [branch, statusRaw, languages, pkgManager, topFiles, projectName] = await Promise.all([
      run("git rev-parse --abbrev-ref HEAD", root),
      run("git status --porcelain", root),
      detectLanguages(root),
      detectPackageManager(root),
      getTopLevelFiles(root),
      getProjectName(root),
    ]);

    const uncommitted = statusRaw ? statusRaw.split("\n").length : 0;
    const gitInfo = branch
      ? `${branch}${uncommitted > 0 ? ` (${uncommitted} uncommitted change${uncommitted > 1 ? "s" : ""})` : ""}`
      : "not a git repo";

    const lines = [
      "## Project Context",
      `- Name: ${projectName}`,
      `- Workspace: ${root}`,
      `- Git: ${gitInfo}`,
    ];

    if (languages.length > 0) lines.push(`- Languages: ${languages.join(", ")}`);
    lines.push(`- Package manager: ${pkgManager}`);
    if (topFiles.length > 0) lines.push(`- Key files: ${topFiles.slice(0, 10).join(", ")}`);

    return [{
      role: "system",
      content: lines.join("\n"),
      source: "project-context",
      priority: 30,
      cacheable: true,
      ttlMs: 60_000,
    }];
  },
};

export const projectContextPlugin = definePlugin({
  id: "context-project",
  name: "Project Context",
  version: "0.1.0",
  register(api) {
    api.registerContextProvider(projectContextProvider);
  },
});

export default projectContextPlugin;
