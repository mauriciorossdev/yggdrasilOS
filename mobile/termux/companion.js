#!/usr/bin/env node
"use strict";

/**
 * Yggdrasil "Proyectos Locales" companion — runs inside Termux on the phone
 * itself, never on the desktop/gateway. Zero non-stdlib dependencies on
 * purpose: shipping this to a phone means copying one file, not cloning the
 * whole pnpm monorepo (see notes/yggdrasil-mobile/local-projects-termux-design.md
 * for why — packages/cli/packages/gateway have no single-file bundle and
 * pull in node-pty/electron native-module entanglement this file must never
 * need).
 *
 * Exposes a small HTTP API, loopback-only, bearer-token-gated (except
 * /health), scoped to a single root directory (`~/projects` by default):
 *   GET  /health                              -> { ok: true }               (no auth)
 *   GET  /projects                            -> { projects: [{name, createdAt}] }
 *   POST /projects            { name }        -> 201 { name, createdAt }
 *   GET  /projects/:name/files?path=<rel>     -> { entries: [{name, type, size?}] }
 *   GET  /projects/:name/file?path=<rel>      -> { content, truncated }
 *   POST /projects/:name/terminal { cli }     -> { port, url, token }
 *
 * The mobile Flutter app is the only intended client, talking to
 * 127.0.0.1:<PORT> from a separate Android app sandbox — see the design doc
 * for why a shared bearer token is the trust boundary between two mutually
 * untrusted apps on the same physical device.
 */

const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const net = require("node:net");

const STATE_DIR = process.env.YGGDRASIL_LOCAL_STATE_DIR || path.join(os.homedir(), ".yggdrasil-local");
const PROJECTS_ROOT = process.env.YGGDRASIL_PROJECTS_ROOT || path.join(os.homedir(), "projects");
const TOKEN_FILE = path.join(STATE_DIR, "token");
const REGISTRY_FILE = path.join(STATE_DIR, "ttyd-registry.json");
const PORT = Number(process.env.YGGDRASIL_LOCAL_PORT || 8765);
const MAX_FILE_BYTES = 1024 * 1024; // 1MB — v1 is a read-only text preview, not a file manager.

const PROOT_DISTRO = process.env.YGGDRASIL_PROOT_DISTRO || "ubuntu";

// claude/agy are glibc binaries — Termux's userland is bionic (Android's libc), so neither runs
// natively there (verified by hand: claude's own installer names "linux-arm64-android" as a known
// platform key but has no published build for it yet; agy's installer downloads a linux_arm64
// binary that fails with "cannot execute: required file not found", a glibc-dynamic-linker
// mismatch). `proot-distro login <distro>` runs them inside a real glibc chroot (ptrace-based, no
// root) that shares Termux's filesystem, so `projectDir` needs no path translation. `shell` stays
// native — it's just Termux's own bash, no glibc binary involved.
const CLI_COMMANDS = {
  claude: "claude",
  agy: "agy",
  shell: process.env.SHELL || "bash",
};
const NEEDS_PROOT = new Set(["claude", "agy"]);

function ensureStateDir() {
  fsSync.mkdirSync(STATE_DIR, { recursive: true });
}

function loadOrCreateToken() {
  ensureStateDir();
  if (fsSync.existsSync(TOKEN_FILE)) {
    return fsSync.readFileSync(TOKEN_FILE, "utf8").trim();
  }
  const token = crypto.randomBytes(24).toString("hex");
  fsSync.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

function loadRegistry() {
  try {
    return JSON.parse(fsSync.readFileSync(REGISTRY_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveRegistry(registry) {
  ensureStateDir();
  fsSync.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Kills any ttyd process this companion spawned in a *previous* run that's
// still alive but isn't a tracked child of *this* run — handles the common
// "companion crashed/phone rebooted, ttyd got orphaned" case without a full
// process-group supervisor (see design doc's "Ciclo de vida" section for why
// this simple policy, not more, is the deliberate v1 scope).
function cleanupOrphans(registry) {
  let changed = false;
  for (const key of Object.keys(registry)) {
    const entry = registry[key];
    if (entry && entry.pid && isPidAlive(entry.pid)) {
      try {
        process.kill(entry.pid, "SIGTERM");
      } catch {
        // already gone between the liveness check and here — fine.
      }
    }
    delete registry[key];
    changed = true;
  }
  if (changed) saveRegistry(registry);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// The single most security-critical function in this file: every path that
// reaches the filesystem goes through this first. Rejects anything that
// normalizes outside `root` (symlink escapes are intentionally NOT resolved
// here — v1 accepts that gap, see design doc "fuera de alcance").
function resolveScoped(root, relPath) {
  const rel = relPath || ".";
  const resolved = path.resolve(root, rel);
  const normalizedRoot = path.resolve(root) + path.sep;
  if (resolved !== path.resolve(root) && !resolved.startsWith(normalizedRoot)) {
    return null;
  }
  return resolved;
}

function isValidProjectName(name) {
  return typeof name === "string" && name.length > 0 && !name.includes("/") && !name.includes("..") && name.trim() === name;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy(); // guard against a runaway body
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function handleListProjects(res) {
  await fs.mkdir(PROJECTS_ROOT, { recursive: true });
  const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const stat = await fs.stat(path.join(PROJECTS_ROOT, entry.name));
    projects.push({ name: entry.name, createdAt: stat.birthtime.toISOString() });
  }
  sendJson(res, 200, { projects });
}

async function handleCreateProject(req, res) {
  const body = await readBody(req);
  if (!isValidProjectName(body.name)) {
    return sendJson(res, 400, { error: "invalid project name" });
  }
  const dir = resolveScoped(PROJECTS_ROOT, body.name);
  if (!dir) return sendJson(res, 400, { error: "invalid project name" });
  if (fsSync.existsSync(dir)) return sendJson(res, 409, { error: "project already exists" });
  await fs.mkdir(dir, { recursive: true });
  const stat = await fs.stat(dir);
  sendJson(res, 201, { name: body.name, createdAt: stat.birthtime.toISOString() });
}

async function handleListFiles(res, projectName, relPath) {
  const projectDir = resolveScoped(PROJECTS_ROOT, projectName);
  if (!projectDir || !isValidProjectName(projectName)) return sendJson(res, 400, { error: "invalid project" });
  const target = resolveScoped(projectDir, relPath);
  if (!target) return sendJson(res, 400, { error: "path escapes project root" });
  if (!fsSync.existsSync(target)) return sendJson(res, 404, { error: "not found" });
  const entries = await fs.readdir(target, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      result.push({ name: entry.name, type: "dir" });
    } else if (entry.isFile()) {
      const stat = await fs.stat(path.join(target, entry.name));
      result.push({ name: entry.name, type: "file", size: stat.size });
    }
  }
  sendJson(res, 200, { entries: result });
}

async function handleReadFile(res, projectName, relPath) {
  const projectDir = resolveScoped(PROJECTS_ROOT, projectName);
  if (!projectDir || !isValidProjectName(projectName)) return sendJson(res, 400, { error: "invalid project" });
  const target = resolveScoped(projectDir, relPath);
  if (!target) return sendJson(res, 400, { error: "path escapes project root" });
  if (!fsSync.existsSync(target)) return sendJson(res, 404, { error: "not found" });
  const stat = await fs.stat(target);
  if (!stat.isFile()) return sendJson(res, 400, { error: "not a file" });
  const truncated = stat.size > MAX_FILE_BYTES;
  const fd = await fs.open(target, "r");
  try {
    const buf = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES));
    await fd.read(buf, 0, buf.length, 0);
    if (buf.includes(0)) {
      return sendJson(res, 415, { error: "binary file, not supported in v1" });
    }
    sendJson(res, 200, { content: buf.toString("utf8"), truncated });
  } finally {
    await fd.close();
  }
}

async function handleStartTerminal(req, res, projectName, registry) {
  const projectDir = resolveScoped(PROJECTS_ROOT, projectName);
  if (!projectDir || !isValidProjectName(projectName) || !fsSync.existsSync(projectDir)) {
    return sendJson(res, 404, { error: "project not found" });
  }
  const body = await readBody(req);
  const cli = body.cli;
  if (!Object.prototype.hasOwnProperty.call(CLI_COMMANDS, cli)) {
    return sendJson(res, 400, { error: "cli must be one of: " + Object.keys(CLI_COMMANDS).join(", ") });
  }

  const key = `${projectName}:${cli}`;
  const existing = registry[key];
  if (existing && isPidAlive(existing.pid)) {
    return sendJson(res, 200, { port: existing.port, url: `http://127.0.0.1:${existing.port}`, token: existing.ttydToken });
  }

  const port = await getFreePort();
  const ttydToken = crypto.randomBytes(12).toString("hex");
  const cliCmd = CLI_COMMANDS[cli];
  const shellLine = `cd ${JSON.stringify(projectDir)} && exec ${cliCmd}`;
  const innerArgs = NEEDS_PROOT.has(cli)
    ? ["proot-distro", "login", PROOT_DISTRO, "--", "bash", "-lc", shellLine]
    : ["bash", "-lc", shellLine];
  const child = spawn("ttyd", ["-p", String(port), "-c", `user:${ttydToken}`, "-W", ...innerArgs], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  registry[key] = { pid: child.pid, port, ttydToken, startedAt: new Date().toISOString() };
  saveRegistry(registry);

  const forget = () => {
    if (registry[key] && registry[key].pid === child.pid) {
      delete registry[key];
      saveRegistry(registry);
    }
  };
  child.on("exit", forget);
  // spawn() failures (e.g. ttyd not installed) surface asynchronously as an 'error' event, after
  // the 200 response below has already gone out — nothing to do about that specific response, but
  // at least don't leave a dead pid in the registry for the next request to (wrongly) reuse.
  child.on("error", forget);

  sendJson(res, 200, { port, url: `http://127.0.0.1:${port}`, token: ttydToken });
}

async function main() {
  const token = loadOrCreateToken();
  const registry = loadRegistry();
  cleanupOrphans(registry);

  console.log(`[yggdrasil-local] token: ${token}`);
  console.log(`[yggdrasil-local] projects root: ${PROJECTS_ROOT}`);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }

      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${token}`) {
        return sendJson(res, 401, { error: "unauthorized" });
      }

      if (req.method === "GET" && url.pathname === "/projects") {
        return await handleListProjects(res);
      }
      if (req.method === "POST" && url.pathname === "/projects") {
        return await handleCreateProject(req, res);
      }

      const filesMatch = url.pathname.match(/^\/projects\/([^/]+)\/files$/);
      if (req.method === "GET" && filesMatch) {
        return await handleListFiles(res, decodeURIComponent(filesMatch[1]), url.searchParams.get("path") || ".");
      }

      const fileMatch = url.pathname.match(/^\/projects\/([^/]+)\/file$/);
      if (req.method === "GET" && fileMatch) {
        return await handleReadFile(res, decodeURIComponent(fileMatch[1]), url.searchParams.get("path") || "");
      }

      const terminalMatch = url.pathname.match(/^\/projects\/([^/]+)\/terminal$/);
      if (req.method === "POST" && terminalMatch) {
        return await handleStartTerminal(req, res, decodeURIComponent(terminalMatch[1]), registry);
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: String((err && err.message) || err) });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[yggdrasil-local] companion listening on http://127.0.0.1:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[yggdrasil-local] fatal:", err);
  process.exit(1);
});
