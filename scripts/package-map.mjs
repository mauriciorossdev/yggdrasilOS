// Writes the package map in ARCHITECTURE.md from each package.json description.
// Run: pnpm package-map. test/integration/docs.test.ts fails when it is stale.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const START = "<!-- package-map:start -->";
export const END = "<!-- package-map:end -->";

export function readPackages(root, folder) {
  const base = join(root, folder);
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(base, e.name, "package.json")))
    .map((e) => {
      const pkg = JSON.parse(readFileSync(join(base, e.name, "package.json"), "utf8"));
      return { dir: `${folder}/${e.name}`, name: e.name, description: pkg.description ?? "" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function renderPackageMap(root) {
  const section = (title, folder) => [
    `### \`${folder}/\` — ${title}`,
    "",
    "| Package | Role |",
    "|---|---|",
    ...readPackages(root, folder).map((p) => `| [\`${p.name}\`](${p.dir}) | ${p.description.replaceAll("|", "\\|")} |`),
    "",
  ];
  return [...section("the platform and the apps", "packages"), ...section("plugins outside the core", "extensions")].join("\n");
}

export function withPackageMap(markdown, root) {
  const start = markdown.indexOf(START);
  const end = markdown.indexOf(END);
  if (start < 0 || end < start) throw new Error("ARCHITECTURE.md has no package map markers");
  return `${markdown.slice(0, start + START.length)}\n\n${renderPackageMap(root)}\n${markdown.slice(end)}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const file = join(root, "ARCHITECTURE.md");
  writeFileSync(file, withPackageMap(readFileSync(file, "utf8"), root));
}
