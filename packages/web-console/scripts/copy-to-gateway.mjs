import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../dist");
const target = join(here, "../../gateway/ui");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(dist, target, { recursive: true });
console.log(`Copied web-console dist → packages/gateway/ui`);
