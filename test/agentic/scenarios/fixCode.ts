import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commandPasses, fileUnchanged, ranCommand, repliedWith, runIn, snapshotFile, TSC } from "../lib/workspaceChecks.js";
import type { Scenario } from "../lib/types.js";

const SUM_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { sum, average } from "./stats.js";

test("sum adds numbers", () => {
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(sum([]), 0);
});

test("average of a list", () => {
  assert.equal(average([2, 4, 6]), 4);
  assert.equal(average([5]), 5);
});

test("average of an empty list is 0", () => {
  assert.equal(average([]), 0);
});
`;

export const fixFailingTest: Scenario = {
  id: "fix-failing-test",
  title: "Make failing tests pass without editing them",
  level: 1,
  tags: ["fix", "commands"],
  turns: ["Los tests de este proyecto fallan. Ejecútalos con `node --test`, encuentra el bug en el código y corrígelo. No modifiques el archivo de tests."],
  setup: async ({ workspace }) => {
    await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "stats", type: "module", scripts: { test: "node --test" } }, null, 2));
    await writeFile(
      join(workspace, "stats.js"),
      `export function sum(values) {
  let total = 0;
  for (let i = 1; i < values.length; i++) total += values[i];
  return total;
}

export function average(values) {
  return sum(values) / values.length;
}
`,
    );
    await writeFile(join(workspace, "stats.test.js"), SUM_TEST);
    await snapshotFile(workspace, "stats.test.js");
  },
  budget: { timeoutMs: 300_000, maxToolCalls: 25 },
  checks: [
    commandPasses("tests-pass", "node --test passes", "node --test", { must: true }),
    fileUnchanged("tests-untouched", "stats.test.js"),
    ranCommand("ran-tests", /node\s+--test|npm\s+(run\s+)?test/, "ran the tests itself before/after the fix"),
  ],
};

export const fixTypeErrors: Scenario = {
  id: "fix-type-errors",
  title: "Fix TypeScript errors properly",
  level: 2,
  tags: ["fix", "commands", "typescript"],
  turns: ["Este proyecto TypeScript no compila. Ejecuta `npm run typecheck`, corrige TODOS los errores de verdad (sin usar `any`, `@ts-ignore` ni `@ts-nocheck`) y confirma que ya no hay errores."],
  setup: async ({ workspace }) => {
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, noEmit: true }, include: ["src"] }, null, 2));
    await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "typed", private: true, type: "module", scripts: { typecheck: `node "${TSC}" -p . --noEmit` } }, null, 2));
    await writeFile(
      join(workspace, "src", "user.ts"),
      `export type User = { id: number; name: string; email?: string };

export function greet(user: User): string {
  return "Hola " + user.name.toUpperCase() + " <" + user.email.toLowerCase() + ">";
}
`,
    );
    await writeFile(
      join(workspace, "src", "cart.ts"),
      `export type Item = { sku: string; price: number; qty: number };

export function total(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function label(n: number): string {
  return n;
}
`,
    );
    await writeFile(
      join(workspace, "src", "main.ts"),
      `import { greet, type User } from "./user";
import { total } from "./cart";

const user: User = { id: "1", name: "Ana" };
console.log(greet(user), total([{ sku: "a", price: 2, qty: 3 }]));
`,
    );
  },
  budget: { timeoutMs: 420_000, maxToolCalls: 40 },
  checks: [
    // The repo's own compiler, so the workspace needs no node_modules.
    commandPasses("tsc", "tsc --noEmit reports no errors", `node "${TSC}" -p . --noEmit`, { must: true }),
    {
      id: "no-escape-hatches",
      description: "no any / @ts-ignore / @ts-nocheck / non-null casts added",
      must: true,
      run: async ({ workspace }) => {
        const r = await runIn(workspace, `grep -rnE "@ts-ignore|@ts-nocheck|@ts-expect-error|: any\\b|as any\\b|as unknown as" src || true`);
        return r.stdout.trim() ? { pass: false, detail: r.stdout.trim() } : { pass: true };
      },
    },
    repliedWith("reports", /(error|errores|compil|tipos)/i, "tells the user the outcome"),
  ],
};
