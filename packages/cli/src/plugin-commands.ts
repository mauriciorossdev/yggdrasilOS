import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PLUGIN_MANIFEST_FILENAME, parsePluginManifest } from "@yggdrasil/sdk";
import { readConfigFile, uniqueStrings, writeConfigFile } from "./config-io.js";
import { resolveWorkspaceRoot } from "./workspace.js";

function detectPackageManager(workspaceRoot: string): "pnpm" | "npm" {
  if (process.env.npm_config_user_agent?.includes("pnpm")) return "pnpm";
  try {
    execSync("pnpm --version", { cwd: workspaceRoot, stdio: "ignore" });
    return "pnpm";
  } catch {
    return "npm";
  }
}

function runPackageAdd(workspaceRoot: string, packageName: string): void {
  const pm = detectPackageManager(workspaceRoot);
  const cmd =
    pm === "pnpm"
      ? `pnpm add ${packageName}`
      : `npm install ${packageName}`;
  execSync(cmd, { cwd: workspaceRoot, stdio: "inherit" });
}

async function resolvePluginIdFromPackage(
  workspaceRoot: string,
  packageName: string,
): Promise<string> {
  const pkgDir = join(workspaceRoot, "node_modules", ...packageName.split("/"));
  const manifestPath = join(pkgDir, PLUGIN_MANIFEST_FILENAME);
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  return parsePluginManifest(raw).id;
}

export async function cmdInit(): Promise<void> {
  const workspaceRoot = await resolveWorkspaceRoot();
  const { exists, path } = await readConfigFile(workspaceRoot);

  if (exists) {
    console.log(`Config already exists at ${path}`);
    return;
  }

  await mkdir(join(workspaceRoot, "extensions"), { recursive: true });
  await mkdir(join(workspaceRoot, "prompts"), { recursive: true });

  const agentMd = `# Agent instructions

You are a helpful assistant. Respond in the user's language.

## Behavior
- Be concise. Don't repeat what the user already knows.
- For destructive actions (delete files, run shell commands with permanent effects), confirm before proceeding.

## Memory
Use memory tools to remember user preferences and important project decisions across sessions.

## Yggdrasil docs
Call \`docs.list\` to see available system docs, \`docs.get("shell-tool")\` to read one.
`;

  const capabilitiesMd = `# Project capabilities

## This project
Describe your project here. What does it do? What tools are most relevant?

## Available tools
Use \`tools.list\` (via gateway) to see all currently active tools.

For Yggdrasil tool details, call \`docs.get("<tool-name>\`) — e.g.:
- \`docs.get("shell-tool")\` — shell_exec sandbox details
- \`docs.get("fs-tool")\` — filesystem tools
- \`docs.get("search-tool")\` — web search
- \`docs.get("memory-tools")\` — long-term memory
- \`docs.list\` — all available docs
`;

  await writeFile(join(workspaceRoot, "prompts", "agent.md"), agentMd, "utf8");
  await writeFile(join(workspaceRoot, "prompts", "capabilities.md"), capabilitiesMd, "utf8");

  await writeConfigFile(workspaceRoot, {
    agents: [{ id: "default", label: "Default Agent", provider: "openai-compat", model: "gpt-4o-mini" }],
    defaultAgent: "default",
    gateway: { port: 18789, host: "127.0.0.1" },
    channels: {
      tui: { enabled: true },
      http: { enabled: false },
    },
    plugins: {
      discoverNodeModules: true,
      installed: [],
      disabled: [],
    },
  });

  console.log(`Created ${path}`);
  console.log(`Created ${join(workspaceRoot, "extensions")}/`);
  console.log(`Created ${join(workspaceRoot, "prompts")}/agent.md`);
  console.log(`Created ${join(workspaceRoot, "prompts")}/capabilities.md`);
  console.log("\nNext steps:");
  console.log("  export OLLAMA_API_KEY=...   # or OPENAI_API_KEY");
  console.log("  yggdrasil plugin install @yggdrasil/tool-weather");
  console.log("  yggdrasil tui");
}

export async function cmdPluginList(): Promise<void> {
  const workspaceRoot = await resolveWorkspaceRoot();
  const { config } = await readConfigFile(workspaceRoot);
  const installed = config.plugins?.installed ?? [];
  const disabled = new Set(config.plugins?.disabled ?? []);

  if (!installed.length) {
    console.log("No plugins in plugins.installed (use: yggdrasil plugin install <pkg>)");
    return;
  }

  for (const id of installed) {
    const status = disabled.has(id) ? "disabled" : "enabled";
    console.log(`${id}\t${status}`);
  }
}

export async function cmdPluginInstall(packageName: string): Promise<void> {
  if (!packageName?.trim()) {
    throw new Error("Package name required. Example: yggdrasil plugin install @yggdrasil/tool-weather");
  }

  const workspaceRoot = await resolveWorkspaceRoot();
  runPackageAdd(workspaceRoot, packageName.trim());

  const pluginId = await resolvePluginIdFromPackage(workspaceRoot, packageName.trim());
  const { config } = await readConfigFile(workspaceRoot);
  const installed = uniqueStrings([...(config.plugins?.installed ?? []), pluginId]);
  const disabled = (config.plugins?.disabled ?? []).filter((id) => id !== pluginId);

  const path = await writeConfigFile(workspaceRoot, {
    plugins: { installed, disabled },
  });

  console.log(`Installed ${packageName} → plugin id "${pluginId}"`);
  console.log(`Updated ${path}`);
}

export async function cmdPluginEnable(pluginId: string): Promise<void> {
  const workspaceRoot = await resolveWorkspaceRoot();
  const { config } = await readConfigFile(workspaceRoot);
  const disabled = (config.plugins?.disabled ?? []).filter((id) => id !== pluginId);
  const installed = uniqueStrings([...(config.plugins?.installed ?? []), pluginId]);

  await writeConfigFile(workspaceRoot, {
    plugins: { installed, disabled },
  });
  console.log(`Enabled plugin "${pluginId}"`);
}

export async function cmdPluginDisable(pluginId: string): Promise<void> {
  const workspaceRoot = await resolveWorkspaceRoot();
  const { config } = await readConfigFile(workspaceRoot);
  const disabled = uniqueStrings([...(config.plugins?.disabled ?? []), pluginId]);

  await writeConfigFile(workspaceRoot, {
    plugins: { disabled },
  });
  console.log(`Disabled plugin "${pluginId}"`);
}

export async function cmdPlugin(argv: string[]): Promise<void> {
  const [sub, arg] = argv;

  switch (sub) {
    case "list":
      await cmdPluginList();
      break;
    case "install":
      await cmdPluginInstall(arg ?? "");
      break;
    case "enable":
      if (!arg) throw new Error("Plugin id required. Example: yggdrasil plugin enable tool-weather");
      await cmdPluginEnable(arg);
      break;
    case "disable":
      if (!arg) throw new Error("Plugin id required. Example: yggdrasil plugin disable tool-weather");
      await cmdPluginDisable(arg);
      break;
    case "create": {
      const { scaffoldPlugin, parseCreatePluginArgs } = await import("./create-plugin.js");
      const workspaceRoot = await resolveWorkspaceRoot();
      const { name, kind } = parseCreatePluginArgs(argv.slice(1));
      if (!name) {
        throw new Error("Plugin name required. Example: yggdrasil plugin create my-tool --kind tool");
      }
      const dir = await scaffoldPlugin(workspaceRoot, name, kind);
      console.log(`Created ${kind} plugin at ${dir}`);
      break;
    }
    default:
      throw new Error(
        `Unknown plugin subcommand: ${sub ?? "(none)"}\n` +
          "Usage: yggdrasil plugin list|install|enable|disable|create",
      );
  }
}
