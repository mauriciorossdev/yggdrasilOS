import { execSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PLUGIN_MANIFEST_FILENAME } from "@yggdrasil/sdk";
import { readConfigFile, uniqueStrings, writeConfigFile } from "./config-io.js";
import { resolveWorkspaceRoot } from "./workspace.js";

/** Normalize specifier to npm-installable form */
function normalizeSpecifier(spec: string): { npmSpec: string; inferredId: string } {
  let s = spec.trim();

  // https://github.com/user/repo → github:user/repo
  const ghHttps = s.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/.*)?$/);
  if (ghHttps) s = `github:${ghHttps[1]}`;

  // user/repo (no leading @, no colon, one slash) → github:user/repo
  if (/^[^@:/][^/]+\/[^/]+$/.test(s)) s = `github:${s}`;

  // Infer a human-friendly id from the specifier
  const idMatch = s.match(/(?:github:)?(?:[^/]+\/)?([^/@#]+)/);
  const inferredId = idMatch?.[1]?.replace(/\.git$/, "") ?? s.replace(/[^a-z0-9-]/g, "-");

  return { npmSpec: s, inferredId };
}

function runInstall(workspaceRoot: string, spec: string): void {
  const pm = process.env.npm_config_user_agent?.includes("pnpm") ? "pnpm" : "npm";
  const cmd = pm === "pnpm" ? `pnpm add ${spec}` : `npm install ${spec}`;
  execSync(cmd, { cwd: workspaceRoot, stdio: "inherit" });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveInstalledDir(workspaceRoot: string, npmSpec: string): Promise<string | undefined> {
  // Try to find where npm installed it by looking at node_modules
  // For github:user/repo, the package name comes from its package.json
  const nmDir = join(workspaceRoot, "node_modules");

  // Try @scope/name or bare name from spec
  const bareMatch = npmSpec.match(/(?:github:[^/]+\/|npm:)?(@?[^@#\s]+)/);
  if (!bareMatch?.[1]) return undefined;

  const candidates = [
    join(nmDir, bareMatch[1]),
    // github: installs use the repo name as the directory under .pnpm or directly
  ];

  for (const c of candidates) {
    if (await fileExists(join(c, "package.json"))) return c;
  }
  return undefined;
}

async function detectFormat(
  workspaceRoot: string,
  npmSpec: string,
  inferredId: string,
): Promise<{ format: "yggdrasil" | "claude-compat" | "unknown"; pkgDir?: string; pkgName?: string }> {
  // For github: installs, npm puts the package under the name from package.json
  // We need to scan node_modules for the recently installed package
  const nmDir = join(workspaceRoot, "node_modules");

  // Read package.json from the installed package to find its name
  // For github installs, try to find by scanning .package-lock.json or package-lock.json
  let pkgDir: string | undefined;
  let pkgName: string | undefined;

  // Try direct resolution
  pkgDir = await resolveInstalledDir(workspaceRoot, npmSpec);

  if (!pkgDir) {
    // Fallback: look in node_modules for a directory whose package.json name matches inferredId
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(nmDir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const pkgJson = join(nmDir, e.name, "package.json");
      const raw = await readFile(pkgJson, "utf8").catch(() => null);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { name?: string };
      if (parsed.name?.includes(inferredId) || e.name === inferredId) {
        pkgDir = join(nmDir, e.name);
        pkgName = parsed.name;
        break;
      }
    }
  }

  if (!pkgDir) return { format: "unknown" };

  const rawPkg = await readFile(join(pkgDir, "package.json"), "utf8").catch(() => "{}");
  pkgName = pkgName ?? (JSON.parse(rawPkg) as { name?: string }).name ?? inferredId;

  if (await fileExists(join(pkgDir, PLUGIN_MANIFEST_FILENAME))) {
    return { format: "yggdrasil", pkgDir, pkgName };
  }
  if (await fileExists(join(pkgDir, ".claude-plugin", "plugin.json"))) {
    return { format: "claude-compat", pkgDir, pkgName };
  }
  // Has skills/ or commands/ directory → also claude-compat
  if (
    (await fileExists(join(pkgDir, "skills"))) ||
    (await fileExists(join(pkgDir, "commands")))
  ) {
    return { format: "claude-compat", pkgDir, pkgName };
  }

  return { format: "unknown", pkgDir, pkgName };
}

async function generateClaudeCompatWrapper(
  workspaceRoot: string,
  skillId: string,
  pkgDir: string,
): Promise<string> {
  const wrapperDir = join(workspaceRoot, "extensions", `skill-${skillId}`);
  await mkdir(join(wrapperDir, "src"), { recursive: true });

  // yggdrasil.plugin.json
  await writeFile(
    join(wrapperDir, "yggdrasil.plugin.json"),
    JSON.stringify({ id: `skill-${skillId}`, kind: ["skill"], entry: "./src/index.mjs", compat: { pluginApi: ">=0.3.0" } }, null, 2),
  );

  // Inline adapter — avoids needing a build step
  const src = `
import { adaptClaudeSkill } from "@yggdrasil/skill-adapter";

const plugin = await adaptClaudeSkill(${JSON.stringify(pkgDir)}, ${JSON.stringify(`skill-${skillId}`)});
export default plugin;
`.trimStart();

  await writeFile(join(wrapperDir, "src", "index.mjs"), src);
  return wrapperDir;
}

export async function cmdSkillInstall(spec: string): Promise<void> {
  if (!spec?.trim()) {
    throw new Error(
      "Skill specifier required. Examples:\n" +
        "  yggdrasil skill install @yggdrasil/skill-git\n" +
        "  yggdrasil skill install juliusbrussee/caveman\n" +
        "  yggdrasil skill install github:user/my-skill",
    );
  }

  const workspaceRoot = await resolveWorkspaceRoot();
  const { npmSpec, inferredId } = normalizeSpecifier(spec);

  console.log(`Installing ${npmSpec}…`);
  runInstall(workspaceRoot, npmSpec);

  const detection = await detectFormat(workspaceRoot, npmSpec, inferredId);

  if (detection.format === "yggdrasil" && detection.pkgDir) {
    // Standard plugin install — read plugin id from manifest
    const manifest = JSON.parse(
      await readFile(join(detection.pkgDir, PLUGIN_MANIFEST_FILENAME), "utf8"),
    ) as { id?: string };
    const pluginId = manifest.id ?? inferredId;
    const { config } = await readConfigFile(workspaceRoot);
    const installed = uniqueStrings([...(config.plugins?.installed ?? []), pluginId]);
    const disabled = (config.plugins?.disabled ?? []).filter((id) => id !== pluginId);
    await writeConfigFile(workspaceRoot, { plugins: { installed, disabled } });
    console.log(`Installed Yggdrasil skill "${pluginId}"`);
    return;
  }

  if (detection.format === "claude-compat" && detection.pkgDir) {
    const skillId = inferredId;
    const wrapperDir = await generateClaudeCompatWrapper(workspaceRoot, skillId, detection.pkgDir);
    const pluginId = `skill-${skillId}`;
    const { config } = await readConfigFile(workspaceRoot);
    const installed = uniqueStrings([...(config.plugins?.installed ?? []), pluginId]);
    const disabled = (config.plugins?.disabled ?? []).filter((id) => id !== pluginId);
    await writeConfigFile(workspaceRoot, { plugins: { installed, disabled } });
    console.log(`Installed Claude-compat skill "${pluginId}"`);
    console.log(`Wrapper at ${wrapperDir}`);
    console.log(`Restart gateway to activate.`);
    return;
  }

  console.warn(`Installed ${npmSpec} but could not detect skill format.`);
  console.warn(`No yggdrasil.plugin.json or .claude-plugin/plugin.json found.`);
}

export async function cmdSkillList(): Promise<void> {
  const workspaceRoot = await resolveWorkspaceRoot();
  const { config } = await readConfigFile(workspaceRoot);
  const installed = config.plugins?.installed ?? [];
  const skills = installed.filter((id) => id.startsWith("skill-") || id.includes("skill"));

  if (skills.length === 0) {
    console.log("No skills installed. Use: yggdrasil skill install <spec>");
    return;
  }
  for (const id of skills) {
    console.log(id);
  }
}

export async function cmdSkill(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "install":
      await cmdSkillInstall(rest.join(" "));
      break;
    case "list":
      await cmdSkillList();
      break;
    default:
      throw new Error(
        `Unknown skill subcommand: ${sub ?? "(none)"}\n` +
          "Usage: yggdrasil skill install <spec> | yggdrasil skill list",
      );
  }
}
