import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commandPasses, exists, fileExists, fileUnchanged, ranCommand, repliedWith, runIn, snapshotFile } from "../lib/workspaceChecks.js";
import type { Scenario } from "../lib/types.js";

export const implementFromSpec: Scenario = {
  id: "implement-from-spec",
  title: "Implement a module from a spec and its tests",
  level: 2,
  tags: ["implement", "commands"],
  turns: ["Lee SPEC.md e implementa lo que pide en slugify.js para que pasen los tests de slugify.test.js (ejecútalos con `node --test`). No cambies los tests."],
  setup: async ({ workspace }) => {
    await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "slug", type: "module" }, null, 2));
    await writeFile(
      join(workspace, "SPEC.md"),
      `# slugify(text, options)

Exports \`slugify\` (named export) from slugify.js.

- Lowercases the text and replaces runs of non-alphanumeric characters with a single "-".
- Accented letters become their plain letter (á → a, ñ → n, ü → u).
- No leading or trailing "-".
- \`options.maxLength\` truncates the result and never leaves a trailing "-".
- Non-string input throws a TypeError.
`,
    );
    await writeFile(
      join(workspace, "slugify.test.js"),
      `import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./slugify.js";

test("basic", () => assert.equal(slugify("Hello World"), "hello-world"));
test("collapses separators", () => assert.equal(slugify("a  --  b___c"), "a-b-c"));
test("strips accents", () => assert.equal(slugify("Camión Ñandú Über"), "camion-nandu-uber"));
test("trims dashes", () => assert.equal(slugify("  ¡Hola!  "), "hola"));
test("maxLength", () => {
  assert.equal(slugify("one two three four", { maxLength: 9 }), "one-two-t");
  assert.equal(slugify("one two three four", { maxLength: 8 }), "one-two");
});
test("type error", () => assert.throws(() => slugify(42), TypeError));
test("empty", () => assert.equal(slugify("!!!"), ""));
`,
    );
    await snapshotFile(workspace, "slugify.test.js");
  },
  budget: { timeoutMs: 300_000, maxToolCalls: 25 },
  checks: [
    fileExists("module", "slugify.js", { must: true }),
    commandPasses("tests-pass", "node --test passes", "node --test", { must: true }),
    fileUnchanged("tests-untouched", "slugify.test.js"),
    ranCommand("ran-tests", /node\s+--test|npm\s+(run\s+)?test/, "ran the tests itself"),
  ],
};

export const debugFromStackTrace: Scenario = {
  id: "debug-from-stacktrace",
  title: "Run a crashing script, read the trace, fix it",
  level: 2,
  tags: ["fix", "commands", "debug"],
  turns: ["Ejecuta `node report.js`. Si falla, lee el error, corrige el código y vuelve a ejecutarlo hasta que funcione. Al final dime el total que imprime."],
  setup: async ({ workspace }) => {
    await writeFile(
      join(workspace, "orders.json"),
      JSON.stringify([
        { id: 1, customer: { name: "Ana" }, lines: [{ sku: "a", price: 10, qty: 2 }] },
        { id: 2, customer: { name: "Luis" }, lines: [{ sku: "b", price: 5.5, qty: 4 }, { sku: "c", price: 3, qty: 1 }] },
        { id: 3, customer: null, lines: [{ sku: "a", price: 10, qty: 1 }] },
        { id: 4, customer: { name: "Eva" }, lines: [] },
      ], null, 2),
    );
    await writeFile(
      join(workspace, "report.js"),
      `import { readFileSync } from "node:fs";

const orders = JSON.parse(readFileSync(new URL("./orders.json", import.meta.url), "utf8"));

let grand = 0;
for (const order of orders) {
  const subtotal = order.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  grand += subtotal;
  console.log(order.customer.name.padEnd(8), subtotal.toFixed(2));
}
console.log("TOTAL", grand.toFixed(2));
`,
    );
    await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "report", type: "module" }, null, 2));
  },
  budget: { timeoutMs: 300_000, maxToolCalls: 20 },
  checks: [
    {
      id: "runs",
      description: "node report.js exits 0 and prints TOTAL 55.00",
      must: true,
      run: async ({ workspace }) => {
        const r = await runIn(workspace, "node report.js");
        return r.code === 0 && /TOTAL\s+55\.00/.test(r.stdout) ? { pass: true } : { pass: false, detail: `exit ${r.code}\n${(r.stderr || r.stdout).slice(-400)}` };
      },
    },
    {
      id: "data-intact",
      description: "orders.json was not edited to dodge the bug",
      must: true,
      run: async ({ workspace }) => {
        const orders = JSON.parse(await readFile(join(workspace, "orders.json"), "utf8")) as unknown[];
        return orders.length === 4 ? { pass: true } : { pass: false, detail: `orders.json now has ${orders.length} records` };
      },
    },
    repliedWith("total", /55([.,]00)?\b/, "tells the user the total (55.00)"),
    ranCommand("ran-report", /node\s+report\.js/, "ran the script itself"),
  ],
};

export const multiTurnCli: Scenario = {
  id: "multi-turn-cli",
  title: "Build a small CLI, then extend it in a follow-up",
  level: 3,
  tags: ["implement", "multi-turn", "commands"],
  turns: [
    "Crea una pequeña CLI en Node (sin dependencias, un solo archivo `todo.js`, ESM) que guarde tareas en `todos.json`. Comandos: `node todo.js add \"texto\"` y `node todo.js list` (una tarea por línea con su número de 1 en adelante). Pruébala ejecutándola.",
    "Ahora agrega el comando `node todo.js done <número>` que marque la tarea como hecha (en `list` se ve como `[x]`, las pendientes como `[ ]`), y crea `todo.test.js` con node:test que verifique add, list y done usando un directorio temporal. Ejecuta los tests.",
  ],
  setup: async ({ workspace }) => {
    await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "todo", type: "module" }, null, 2));
  },
  budget: { timeoutMs: 420_000, maxToolCalls: 60 },
  checks: [
    fileExists("cli", "todo.js", { must: true }),
    {
      id: "behaves",
      description: "add / list / done work end to end (graded by running it)",
      must: true,
      run: async ({ workspace }) => {
        if (!(await exists(join(workspace, "todo.js")))) return { pass: false, detail: "todo.js does not exist" };
        const dir = join(workspace, ".grade");
        await mkdir(dir, { recursive: true });
        // Fresh store: a copy of the script in an empty directory, so the model's own todos.json isn't reused
        // (whether it keeps the data next to the script or in the cwd).
        await copyFile(join(workspace, "todo.js"), join(dir, "todo.js"));
        const run = (cmd: string) => runIn(dir, `node todo.js ${cmd}`);
        await run('add "comprar pan"');
        await run('add "llamar a Ana"');
        const before = (await run("list")).stdout;
        await run("done 1");
        const after = (await run("list")).stdout;
        const okBefore = /1.*comprar pan/.test(before) && /2.*llamar a Ana/.test(before);
        const okAfter = /\[x\].*comprar pan|comprar pan.*\[x\]/.test(after) && /\[ \].*llamar a Ana|llamar a Ana.*\[ \]/.test(after);
        return okBefore && okAfter ? { pass: true } : { pass: false, detail: `list before:\n${before}\nlist after done 1:\n${after}` };
      },
    },
    fileExists("tests", "todo.test.js"),
    commandPasses("tests-pass", "the model's own tests pass (node --test)", "node --test todo.test.js", { weight: 2 }),
    ranCommand("ran-tests", /node\s+--test/, "ran the tests itself"),
  ],
};
