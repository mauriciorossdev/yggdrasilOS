#!/usr/bin/env node
// End-to-end tests of the mobile app (mobile/app, Flutter) on an Android
// emulator, against a real headless gateway with a throwaway QA workspace.
//
//   node scripts/mobile-e2e.mjs [--avd ygg_e2e_api34] [--stop-emulator] [--name <test name filter>]
//
// What it does:
//  1. Boots the AVD unless an emulator is already attached. It must be x86_64
//     or arm64: Flutter no longer runs on 32-bit x86 Android images.
//  2. Creates a fresh QA workspace in the OS temp dir (never a real project)
//     and starts `packages/cli/dist/index.js gateway` on it: builtin echo
//     agent (deterministic, no LLM), a fixed QA API key, HOME pointed at the
//     QA dir so the user's ~/.yggdrasil is never read or written.
//  3. Starts a small control server the tests call (through adb reverse) to
//     take screenshots (adb screencap) and to stop/start the gateway.
//  4. Pre-installs the debug APK with every runtime permission granted (so no
//     native permission dialog covers the UI; `flutter test`'s own reinstall
//     keeps the grants), then runs `flutter test integration_test/app_e2e_test.dart`.
//  5. Always cleans up: gateway, control server, adb reverse rules.
//
// Artifacts (screenshots, gateway/flutter/logcat logs) land in
// mobile/app/build/e2e/<timestamp>/ (build/ is gitignored).
//
// Needs: flutter on PATH (or ~/development/flutter/bin), the Android SDK
// (ANDROID_HOME or ~/Library/Android/sdk), and `pnpm build` done for the CLI.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { existsSync, mkdirSync, rmSync, writeFileSync, createWriteStream } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(ROOT, "mobile", "app");
const GATEWAY_PORT = 18789;
const CONTROL_PORT = 18790;
const API_KEY = "ygg-e2e-qa-key";
const APP_ID = "com.mauriciorossdev.yggdrasil.dev";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const AVD = opt("--avd", "ygg_e2e_api34");
const NAME_FILTER = opt("--name", undefined);

const ANDROID_HOME = process.env.ANDROID_HOME ?? join(homedir(), "Library", "Android", "sdk");
const ADB = join(ANDROID_HOME, "platform-tools", "adb");
const EMULATOR = join(ANDROID_HOME, "emulator", "emulator");
const FLUTTER_BIN = join(homedir(), "development", "flutter", "bin");
const PATH = [FLUTTER_BIN, process.env.PATH].join(":");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const ARTIFACTS = join(APP_DIR, "build", "e2e", stamp);
const SHOTS = join(ARTIFACTS, "screenshots");
const QA_ROOT = join(tmpdir(), "ygg-mobile-e2e");
const WORKSPACE = join(QA_ROOT, "workspace");
const QA_HOME = join(QA_ROOT, "home");

const log = (...m) => console.log("[mobile-e2e]", ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync(ADB, a, { encoding: "utf8" }).trim();

function portOpen(port) {
  return new Promise((res) => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("error", () => res(false));
  });
}

async function waitFor(what, check, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ---------- emulator ----------

function attachedEmulator() {
  return adb("devices")
    .split("\n")
    .slice(1)
    .map((l) => l.split("\t"))
    .find(([serial, state]) => serial?.startsWith("emulator-") && state === "device")?.[0];
}

async function ensureEmulator() {
  let serial = attachedEmulator();
  if (serial) {
    log(`using running emulator ${serial}`);
    return { serial, startedByUs: false };
  }
  log(`booting AVD ${AVD}…`);
  const child = spawn(EMULATOR, ["-avd", AVD, "-no-snapshot-save", "-no-boot-anim", "-no-audio"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await waitFor("emulator to attach", async () => Boolean((serial = attachedEmulator())), 180_000);
  await waitFor(
    "emulator boot",
    async () => {
      try {
        return adb("-s", serial, "shell", "getprop", "sys.boot_completed") === "1";
      } catch {
        return false;
      }
    },
    // A cold first boot of a new AVD takes 5+ minutes on an Intel Mac.
    600_000,
  );
  log(`emulator ${serial} booted`);
  return { serial, startedByUs: true };
}

// ---------- QA workspace + gateway ----------

function seedWorkspace() {
  rmSync(QA_ROOT, { recursive: true, force: true });
  mkdirSync(join(WORKSPACE, "src"), { recursive: true });
  mkdirSync(join(WORKSPACE, "notes"), { recursive: true });
  mkdirSync(QA_HOME, { recursive: true });
  writeFileSync(join(WORKSPACE, "README.md"), "# ygg-qa-mobile\n\nProyecto desechable para las pruebas E2E de la app mobile.\n");
  writeFileSync(join(WORKSPACE, "src", "hello.ts"), 'export const hello = (name: string) => `hola ${name}`;\n');
  writeFileSync(join(WORKSPACE, "notes", "todo.md"), "- [ ] probar la app mobile\n");
  writeFileSync(
    join(WORKSPACE, "yggdrasil.config.json"),
    JSON.stringify(
      {
        agents: [{ id: "default", label: "E2E Echo", provider: "builtin", model: "echo" }],
        defaultAgent: "default",
        gateway: { port: GATEWAY_PORT, host: "127.0.0.1" },
        plugins: { load: { paths: [] }, discoverNodeModules: false, installed: [], disabled: [] },
      },
      null,
      2,
    ),
  );
  const git = (...a) => execFileSync("git", a, { cwd: WORKSPACE, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "add", "-A");
  git("-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "-q", "-m", "seed");

  const now = Date.now();
  writeFileSync(
    join(QA_ROOT, "projects.json"),
    JSON.stringify([{ id: "qa-mobile", name: "ygg-qa-mobile", path: WORKSPACE, createdAt: now, lastOpenedAt: now }]),
  );
  writeFileSync(join(QA_ROOT, "open-gateways.json"), JSON.stringify({ "qa-mobile": { port: GATEWAY_PORT } }));
}

let gateway = null;
const gatewayLog = () => createWriteStream(join(ARTIFACTS, "gateway.log"), { flags: "a" });

async function startGateway() {
  if (gateway) return;
  const cli = join(ROOT, "packages", "cli", "dist", "index.js");
  if (!existsSync(cli)) throw new Error(`missing ${cli} — run pnpm --filter "@yggdrasil/cli..." run build`);
  const out = gatewayLog();
  out.write(`\n--- start ${new Date().toISOString()}\n`);
  gateway = spawn(process.execPath, [cli, "gateway"], {
    cwd: WORKSPACE,
    env: {
      ...process.env,
      HOME: QA_HOME,
      YGGDRASIL_WORKSPACE: WORKSPACE,
      YGGDRASIL_GATEWAY_PORT: String(GATEWAY_PORT),
      YGGDRASIL_GATEWAY_HOST: "127.0.0.1",
      YGGDRASIL_API_KEY: API_KEY,
      YGGDRASIL_PROJECTS_FILE: join(QA_ROOT, "projects.json"),
      YGGDRASIL_OPEN_GATEWAYS_FILE: join(QA_ROOT, "open-gateways.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  gateway.stdout.pipe(out);
  gateway.stderr.pipe(out);
  const proc = gateway;
  proc.once("exit", (code, signal) => {
    out.write(`--- exit code=${code} signal=${signal}\n`);
    if (gateway === proc) gateway = null;
  });
  await waitFor("gateway port", () => portOpen(GATEWAY_PORT), 60_000);
  log(`gateway up on ${GATEWAY_PORT}`);
}

async function stopGateway() {
  const proc = gateway;
  if (!proc) return;
  gateway = null;
  proc.kill("SIGTERM");
  await Promise.race([new Promise((r) => proc.once("exit", r)), sleep(5000)]);
  if (proc.exitCode === null) proc.kill("SIGKILL");
  await waitFor("gateway port to close", async () => !(await portOpen(GATEWAY_PORT)), 10_000);
  log("gateway stopped");
}

// ---------- control server (called by the tests through adb reverse) ----------

function startControl(serial) {
  let shotIndex = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const reply = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      if (url.pathname === "/screenshot") {
        const name = (url.searchParams.get("name") ?? "shot").replace(/[^\w.-]+/g, "_");
        const file = join(SHOTS, `${String(++shotIndex).padStart(2, "0")}-${name}.png`);
        const png = execFileSync(ADB, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
        writeFileSync(file, png);
        return reply(200, { ok: true, file });
      }
      if (url.pathname === "/gateway/stop") return (await stopGateway(), reply(200, { ok: true }));
      if (url.pathname === "/gateway/start") return (await startGateway(), reply(200, { ok: true }));
      if (url.pathname === "/status") return reply(200, { ok: true, gatewayUp: Boolean(gateway) });
      reply(404, { ok: false });
    } catch (err) {
      reply(500, { ok: false, error: String(err) });
    }
  });
  return new Promise((r) => server.listen(CONTROL_PORT, "127.0.0.1", () => r(server)));
}

// An overloaded emulator (first boot, Intel Mac) pops "Process system isn't
// responding"; it doesn't block Flutter's own taps but covers every screenshot.
function quietSystemDialogs(serial) {
  for (const cmd of [
    ["settings", "put", "global", "hide_error_dialogs", "1"],
    ["settings", "put", "global", "anr_show_background", "0"],
    ["am", "broadcast", "-a", "android.intent.action.CLOSE_SYSTEM_DIALOGS"],
  ]) {
    try {
      adb("-s", serial, "shell", ...cmd);
    } catch {}
  }
}

// ---------- app install ----------

async function preinstallWithPermissions(serial) {
  log("building the debug APK to pre-grant its permissions…");
  execFileSync("flutter", ["build", "apk", "--debug"], { cwd: APP_DIR, env: { ...process.env, PATH }, stdio: "ignore" });
  const apk = join(APP_DIR, "build", "app", "outputs", "flutter-apk", "app-debug.apk");
  execFileSync(ADB, ["-s", serial, "install", "-r", "-g", apk], { stdio: "ignore" });
  log(`installed ${APP_ID} with runtime permissions granted`);
}

// ---------- main ----------

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  for (const [port, what] of [
    [GATEWAY_PORT, "gateway"],
    [CONTROL_PORT, "control server"],
  ]) {
    if (await portOpen(port)) throw new Error(`port ${port} (${what}) is already in use — stop whatever holds it first`);
  }

  const { serial, startedByUs } = await ensureEmulator();
  let control;
  let exitCode = 1;
  try {
    seedWorkspace();
    await startGateway();
    control = await startControl(serial);
    adb("-s", serial, "reverse", `tcp:${GATEWAY_PORT}`, `tcp:${GATEWAY_PORT}`);
    adb("-s", serial, "reverse", `tcp:${CONTROL_PORT}`, `tcp:${CONTROL_PORT}`);
    adb("-s", serial, "logcat", "-c");
    quietSystemDialogs(serial);
    await preinstallWithPermissions(serial);

    const flutterArgs = [
      "test",
      "integration_test/app_e2e_test.dart",
      "-d",
      serial,
      `--dart-define=E2E_API_KEY=${API_KEY}`,
      `--dart-define=E2E_GATEWAY_URL=http://127.0.0.1:${GATEWAY_PORT}`,
      `--dart-define=E2E_CONTROL_URL=http://127.0.0.1:${CONTROL_PORT}`,
      "-r",
      "expanded",
    ];
    if (NAME_FILTER) flutterArgs.push("--plain-name", NAME_FILTER);
    log(`flutter ${flutterArgs.join(" ")}`);
    const out = createWriteStream(join(ARTIFACTS, "flutter.log"));
    const flutter = spawn("flutter", flutterArgs, { cwd: APP_DIR, env: { ...process.env, PATH }, stdio: ["ignore", "pipe", "pipe"] });
    for (const s of [flutter.stdout, flutter.stderr]) {
      s.on("data", (d) => (process.stdout.write(d), out.write(d)));
    }
    exitCode = await new Promise((r) => flutter.once("exit", (code) => r(code ?? 1)));
  } finally {
    try {
      writeFileSync(join(ARTIFACTS, "logcat.txt"), execFileSync(ADB, ["-s", serial, "logcat", "-d", "-v", "time"], { maxBuffer: 256 * 1024 * 1024 }));
    } catch {}
    for (const port of [GATEWAY_PORT, CONTROL_PORT]) {
      try {
        adb("-s", serial, "reverse", "--remove", `tcp:${port}`);
      } catch {}
    }
    control?.close();
    await stopGateway().catch(() => {});
    if (startedByUs && flag("--stop-emulator")) {
      try {
        adb("-s", serial, "emu", "kill");
      } catch {}
    }
    log(`artifacts: ${ARTIFACTS}`);
    log(`app id on the emulator: ${APP_ID}`);
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[mobile-e2e]", err.message ?? err);
  process.exit(1);
});
