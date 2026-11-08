import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exists, fileExists, repliedWith, usedTool } from "../lib/workspaceChecks.js";
import type { Scenario } from "../lib/types.js";

const READ_TOOLS = ["read_file", "fs_read_file"];
const LIST_TOOLS = ["list_directory", "fs_list_dir"];

export const helloFile: Scenario = {
  id: "hello-file",
  title: "Create a file with exact content",
  level: 0,
  tags: ["smoke", "write"],
  turns: ["Crea un archivo notes.txt en este directorio que contenga exactamente la línea: hola yggdrasil"],
  budget: { timeoutMs: 120_000, maxToolCalls: 6 },
  checks: [
    fileExists("file", "notes.txt", { must: true }),
    {
      id: "content",
      description: "notes.txt contains exactly 'hola yggdrasil'",
      must: true,
      async run({ workspace }) {
        if (!(await exists(join(workspace, "notes.txt")))) return { pass: false, detail: "no file" };
        const text = (await readFile(join(workspace, "notes.txt"), "utf8")).trim();
        return text === "hola yggdrasil" ? { pass: true } : { pass: false, detail: `got ${JSON.stringify(text)}` };
      },
    },
  ],
};

export const readAndAnswer: Scenario = {
  id: "read-and-answer",
  title: "Read a file instead of guessing",
  level: 0,
  tags: ["smoke", "read"],
  // A value the model cannot know without opening the file.
  turns: ["¿En qué puerto escucha el servicio según config.json? Responde solo con el número."],
  setup: async ({ workspace }) => {
    await writeFile(join(workspace, "config.json"), JSON.stringify({ service: "billing", server: { host: "0.0.0.0", port: 48213 } }, null, 2));
  },
  budget: { timeoutMs: 120_000, maxToolCalls: 6 },
  checks: [
    repliedWith("answer", /48213/, "reply contains the real port (48213)", { must: true }),
    usedTool("opened-file", READ_TOOLS, "read the file with a read tool (did not guess)"),
  ],
};

export const recoverFromToolError: Scenario = {
  id: "recover-from-tool-error",
  title: "Recover when the file is not where it was said to be",
  level: 1,
  tags: ["recovery", "read"],
  turns: ["Lee el archivo guides/setup.md y dime qué comando hay que ejecutar para instalar las dependencias. Cita el comando tal cual."],
  setup: async ({ workspace }) => {
    // The prompt points at guides/, the file is really in docs/.
    await mkdir(join(workspace, "docs"), { recursive: true });
    await writeFile(join(workspace, "docs", "setup.md"), "# Setup\n\nInstall with:\n\n    pnpm install --frozen-lockfile --ignore-scripts\n");
    await writeFile(join(workspace, "README.md"), "# Project\nSee docs/.\n");
  },
  budget: { timeoutMs: 180_000, maxToolCalls: 12 },
  checks: [
    repliedWith("command", /pnpm install --frozen-lockfile --ignore-scripts/, "reply quotes the real command", { must: true }),
    usedTool("searched", [...LIST_TOOLS, "fs_search", "run_command", "shell_exec"], "looked around (listed/searched) after the miss"),
    {
      id: "no-invented",
      description: "did not answer before reading anything",
      run: ({ toolCalls }) => (toolCalls.length > 0 ? { pass: true } : { pass: false, detail: "answered without using any tool" }),
    },
  ],
};
