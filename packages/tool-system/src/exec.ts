import { exec } from "node:child_process";
import { promisify } from "node:util";

export const execAsync = promisify(exec);

export const EXEC_OPTS = { maxBuffer: 10 * 1024 * 1024, timeout: 30_000 } as const;
