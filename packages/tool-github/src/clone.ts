import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getRepo } from "./github-api.js";

const CLONE_TIMEOUT_MS = 10 * 60_000;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clones over HTTPS authenticated with the stored token. The token is passed
 * as an Authorization header through GIT_CONFIG_* env vars — never in the
 * URL (it would be persisted in the clone's .git/config) and never in argv
 * (visible in the process list).
 */
export async function cloneRepo(
  accessToken: string,
  params: { repo: string; parentDir: string; folderName?: string },
): Promise<{ path: string; repo: string }> {
  const repo = await getRepo(accessToken, params.repo);
  const folder = (params.folderName?.trim() || repo.name).trim();
  if (!folder || folder === "." || folder === ".." || /[\\/]/.test(folder)) {
    throw new Error(`Invalid folder name "${folder}".`);
  }
  const target = resolve(join(params.parentDir, folder));
  if (await exists(target)) throw new Error(`"${target}" already exists — pick another folder or name.`);

  const basic = Buffer.from(`x-access-token:${accessToken}`).toString("base64");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("git", ["clone", "--", repo.cloneUrl, target], {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
      },
    });
    let stderr = "";
    child.stderr?.on("data", (c) => {
      stderr += c.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("git clone timed out"));
    }, CLONE_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not run git (is it installed and on PATH?): ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(`git clone failed (exit ${code}): ${stderr.replaceAll(basic, "***").trim().slice(-500)}`));
    });
  });
  return { path: target, repo: repo.fullName };
}
