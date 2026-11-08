import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { commandPasses, exists, fileExists, listFiles, ranCommand } from "../lib/workspaceChecks.js";
import type { Scenario } from "../lib/types.js";

const defines = (src: string, name: string) => new RegExp(`(?:function|const|let|var|class)\\s+${name}\\b`).test(src);

/**
 * The prompt asks for a Counter and a TodoList used from App. Where they live is the model's call — separate
 * files or inline in App.jsx are both fine — so this looks for the component definitions anywhere under src/
 * and for App referencing both. Returns a description of what is wrong, or null.
 */
export function checkComponents(sources: Record<string, string>): string | null {
  const entries = Object.entries(sources);
  const missing = ["Counter", "TodoList"].filter((name) => !entries.some(([, src]) => defines(src, name)));
  if (missing.length) return `no definition of: ${missing.join(", ")}`;
  const app = entries.find(([file]) => /(^|\/)App\.(jsx?|tsx?)$/.test(file));
  if (!app) return "no App component file";
  const unused = ["Counter", "TodoList"].filter((name) => !new RegExp(`\\b${name}\\b`).test(app[1].replace(new RegExp(`(?:function|const|let|var|class)\\s+${name}\\b`), "")));
  return unused.length ? `App does not use: ${unused.join(", ")}` : null;
}

export const reactViteApp: Scenario = {
  id: "react-vite-app",
  title: "Scaffold a React + Vite app, install and build it",
  level: 3,
  tags: ["project", "network", "slow", "react"],
  turns: [
    "Crea una aplicación React con Vite (JavaScript, sin TypeScript) en este mismo directorio, sin carpetas anidadas. Debe tener un componente `Counter` (botón que suma 1 y muestra el valor) y un componente `TodoList` (input para agregar tareas y lista), ambos usados desde `App.jsx`. Instala las dependencias y ejecuta `npm run build` hasta que compile sin errores.",
  ],
  budget: { timeoutMs: 900_000, maxToolCalls: 60 },
  checks: [
    {
      id: "package",
      description: "package.json depends on react, react-dom and vite",
      must: true,
      run: async ({ workspace }) => {
        if (!(await exists(join(workspace, "package.json")))) return { pass: false, detail: "no package.json (nested folder?)" };
        const pkg = JSON.parse(await readFile(join(workspace, "package.json"), "utf8")) as { dependencies?: object; devDependencies?: object };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
        const missing = ["react", "react-dom", "vite"].filter((d) => !deps[d]);
        return missing.length ? { pass: false, detail: `missing: ${missing.join(", ")}` } : { pass: true };
      },
    },
    {
      id: "components",
      description: "Counter and TodoList components exist (in their own files or inside App) and App uses them",
      must: true,
      run: async ({ workspace }) => {
        const files = (await listFiles(workspace)).filter((f) => /^src\/.*\.(jsx?|tsx?)$/.test(f));
        const sources: Record<string, string> = {};
        for (const f of files) sources[f] = await readFile(join(workspace, f), "utf8");
        const problem = checkComponents(sources);
        return problem ? { pass: false, detail: `${problem}\nsource files: ${files.join(", ") || "none"}` } : { pass: true };
      },
    },
    commandPasses("build", "npm run build succeeds (graded by running it)", "npm run build", { must: true, timeoutMs: 300_000 }),
    fileExists("dist", "dist/index.html"),
    ranCommand("installed", /npm\s+(i|install|ci)\b|pnpm\s+(i|install)\b/, "installed dependencies itself"),
    ranCommand("built", /npm\s+run\s+build|vite\s+build/, "ran the build itself"),
  ],
};
