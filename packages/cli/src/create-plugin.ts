import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PluginKind = "channel" | "tool" | "harness" | "provider" | "skill";

export function parseCreatePluginArgs(argv: string[]): { name?: string; kind: PluginKind } {
  let kind: PluginKind = "tool";
  let name: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--kind" && argv[i + 1]) {
      kind = argv[i + 1] as PluginKind;
      i++;
      continue;
    }
    if (!arg.startsWith("-") && !name) {
      name = arg;
    }
  }

  return { name, kind };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, "../templates");

function toPackageName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
}

function toPluginId(name: string): string {
  return toPackageName(name);
}

async function renderTemplate(content: string, vars: Record<string, string>): Promise<string> {
  let out = content;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

async function copyRenderedTemplate(
  kind: PluginKind,
  fileName: string,
  destDir: string,
  vars: Record<string, string>,
): Promise<void> {
  const src = join(templatesDir, kind, fileName);
  const raw = await readFile(src, "utf8");
  const rendered = await renderTemplate(raw, vars);
  const destPath = join(destDir, fileName);
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, rendered);
}

export async function createPluginProject(options: {
  name: string;
  kind: PluginKind;
  outputDir: string;
}): Promise<string> {
  const pluginId = toPluginId(options.name);
  const packageName = `@yggdrasil/${pluginId}`;
  const vars = {
    PLUGIN_NAME: options.name,
    PLUGIN_ID: pluginId,
    PACKAGE_NAME: packageName,
    PLUGIN_LABEL: options.name.replace(/-/g, " "),
  };

  await mkdir(options.outputDir, { recursive: true });

  const files = ["package.json", "tsconfig.json", "yggdrasil.plugin.json", "src/index.ts"];
  for (const file of files) {
    await copyRenderedTemplate(options.kind, file, options.outputDir, vars);
  }

  return options.outputDir;
}

export async function scaffoldPlugin(
  workspaceRoot: string,
  name: string,
  kind: PluginKind,
): Promise<string> {
  const outputDir = join(workspaceRoot, "extensions", toPluginId(name));
  return createPluginProject({ name, kind, outputDir });
}
