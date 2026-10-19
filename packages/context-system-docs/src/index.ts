import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { definePlugin } from "@yggdrasil/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SYSTEM_DOCS_DIR = join(__dirname, "../docs");

export function getSystemDocsPath(): string {
  return SYSTEM_DOCS_DIR;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-z0-9-]/g, "");
}

const plugin = definePlugin({
  id: "context-system-docs",
  name: "System Docs",
  version: "0.1.0",
  register(api) {
    api.registerGatewayMethod("docs.get", async (params) => {
      const name = sanitizeName(String(params.name ?? ""));
      if (!name) throw new Error("docs.get: name required");
      const filePath = join(SYSTEM_DOCS_DIR, `${name}.md`);
      const content = await readFile(filePath, "utf8");
      return { name, content };
    });

    api.registerGatewayMethod("docs.list", async () => {
      const files = await readdir(SYSTEM_DOCS_DIR);
      const docs = files
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(".md", ""))
        .sort();
      return { docs };
    });
  },
});

export default plugin;
