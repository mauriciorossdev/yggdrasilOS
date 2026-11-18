import { execFile } from "node:child_process";
import { appendFile, mkdir, open, rename, stat, statfs } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { app, powerMonitor } from "electron";

/**
 * Background system monitor: while Yggdrasil is open, samples CPU, RAM/swap,
 * disk, per-process Electron usage (incl. the GPU process) and main-thread
 * responsiveness, and appends JSON lines to `system-monitor.log` so that after a
 * freeze or WindowServer/watchdog crash there is a timeline of what the machine
 * was doing right before.
 *
 * Electron exposes no real GPU utilisation counter; the GPU *process* CPU/RAM
 * is the closest signal, and macOS thermal state is logged separately.
 * Only numbers and process names are written — no project/session content.
 */

const LOG_FILE = "system-monitor.log";
const SAMPLE_MS = 5_000;
const SNAPSHOT_EVERY = 12; // full process snapshot every 60s, or immediately on a warning
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LAG_WARN_MS = 500;
const CPU_WARN = 90;
const SWAP_WARN_MB = 2048;
const DISK_WARN_GB = 5;

let timer: NodeJS.Timeout | null = null;
let prevCpu = readCpuTimes();
let ticks = 0;
let lastTick = Date.now();
let sampling = false;

export function systemMonitorLogPath(): string {
  return join(app.getPath("logs"), LOG_FILE);
}

function readCpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000, maxBuffer: 1024 * 1024 }, (err, stdout) => resolve(err ? "" : stdout));
  });
}

/** macOS memory pressure: 1 normal, 2 warn, 4 critical. */
async function memoryPressure(): Promise<number | undefined> {
  if (process.platform !== "darwin") return undefined;
  const n = Number((await run("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"])).trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Swap in use, MB. Electron's memory info has no swap-used on macOS, so ask the kernel. */
async function swapUsedMB(mem: Electron.SystemMemoryInfo): Promise<number | undefined> {
  if (process.platform === "darwin") {
    const m = (await run("sysctl", ["-n", "vm.swapusage"])).match(/used = ([\d.]+)M/);
    return m ? Math.round(Number(m[1])) : undefined;
  }
  return mem.swapTotal !== undefined && mem.swapFree !== undefined
    ? Math.round((mem.swapTotal - mem.swapFree) / 1024)
    : undefined;
}

/** Top system-wide processes — only taken on a warning / every minute, never per tick. */
async function topProcesses(): Promise<{ name: string; pid: number; cpu: number; rssMB: number }[]> {
  if (process.platform === "win32") return [];
  const out = await run("ps", ["-Aceo", "pid=,pcpu=,rss=,comm=", "-r"]);
  const rows = out
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ pid: Number(m[1]), cpu: Number(m[2]), rssMB: Math.round(Number(m[3]) / 1024), name: m[4] }));
  const byCpu = rows.slice(0, 6);
  const byMem = [...rows].sort((a, b) => b.rssMB - a.rssMB).slice(0, 6);
  const seen = new Set<number>();
  return [...byCpu, ...byMem].filter((r) => (seen.has(r.pid) ? false : (seen.add(r.pid), true)));
}

async function rotateIfNeeded(path: string): Promise<void> {
  try {
    if ((await stat(path)).size > MAX_LOG_BYTES) await rename(path, `${path}.1`);
  } catch {
    /* no file yet */
  }
}

async function write(record: Record<string, unknown>): Promise<void> {
  try {
    const path = systemMonitorLogPath();
    await mkdir(app.getPath("logs"), { recursive: true });
    await rotateIfNeeded(path);
    await appendFile(path, `${JSON.stringify({ t: new Date().toISOString(), ...record })}\n`, "utf8");
  } catch {
    /* monitoring must never take the app down */
  }
}

async function lastRecord(): Promise<Record<string, unknown> | null> {
  try {
    const fh = await open(systemMonitorLogPath(), "r");
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, 16 * 1024);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const lines = buf.toString("utf8").trim().split("\n");
      return JSON.parse(lines[lines.length - 1] ?? "null");
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

async function sample(): Promise<void> {
  if (sampling) return;
  sampling = true;
  try {
    const now = Date.now();
    const lagMs = Math.max(0, now - lastTick - SAMPLE_MS);
    lastTick = now;

    const cur = readCpuTimes();
    const dTotal = cur.total - prevCpu.total;
    const cpuPct = dTotal > 0 ? Math.round((1 - (cur.idle - prevCpu.idle) / dTotal) * 100) : 0;
    prevCpu = cur;

    const mem = process.getSystemMemoryInfo(); // KB
    const swapMB = await swapUsedMB(mem);
    const totalMB = Math.round(mem.total / 1024);
    const freeMB = Math.round((mem.free + (mem.purgeable ?? 0)) / 1024);

    let diskFreeGB: number | undefined;
    try {
      const s = await statfs(app.getPath("userData"));
      diskFreeGB = Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10;
    } catch {
      /* ignore */
    }

    const metrics = app.getAppMetrics();
    const gpu = metrics.find((m) => m.type === "GPU");
    const appCpu = Math.round(metrics.reduce((a, m) => a + m.cpu.percentCPUUsage, 0));
    const appMemMB = Math.round(metrics.reduce((a, m) => a + m.memory.workingSetSize, 0) / 1024);

    const pressure = await memoryPressure();
    const thermal = process.platform === "darwin" ? powerMonitor.getCurrentThermalState() : undefined;

    const warn: string[] = [];
    if (cpuPct >= CPU_WARN) warn.push(`cpu ${cpuPct}%`);
    if (swapMB !== undefined && swapMB >= SWAP_WARN_MB) warn.push(`swap ${swapMB}MB`);
    if (pressure && pressure >= 2) warn.push(`memory-pressure ${pressure === 4 ? "critical" : "warn"}`);
    if (diskFreeGB !== undefined && diskFreeGB < DISK_WARN_GB) warn.push(`disk free ${diskFreeGB}GB`);
    if (lagMs >= LAG_WARN_MS) warn.push(`main-thread stall ${lagMs}ms`);
    if (thermal === "serious" || thermal === "critical") warn.push(`thermal ${thermal}`);

    ticks++;
    const snapshot = warn.length > 0 || ticks % SNAPSHOT_EVERY === 0;
    await write({
      kind: warn.length ? "warn" : "sample",
      ...(warn.length ? { warn } : {}),
      cpuPct,
      load1: Math.round(os.loadavg()[0] * 100) / 100,
      ramFreeMB: freeMB,
      ramTotalMB: totalMB,
      swapUsedMB: swapMB,
      pressure,
      diskFreeGB,
      thermal,
      lagMs,
      app: {
        cpuPct: appCpu,
        memMB: appMemMB,
        gpuCpuPct: gpu ? Math.round(gpu.cpu.percentCPUUsage) : undefined,
        gpuMemMB: gpu ? Math.round(gpu.memory.workingSetSize / 1024) : undefined,
        procs: metrics.length,
      },
      ...(snapshot ? { top: await topProcesses() } : {}),
    });
  } catch (error) {
    await write({ kind: "monitor-error", error: error instanceof Error ? error.message : String(error) });
  } finally {
    sampling = false;
  }
}

export async function startSystemMonitor(): Promise<void> {
  if (timer) return;
  const prev = await lastRecord();
  if (prev && prev.kind !== "stop") {
    await write({ kind: "unclean-previous-exit", lastRecord: prev });
  }
  await write({
    kind: "start",
    version: app.getVersion(),
    electron: process.versions.electron,
    os: `${os.type()} ${os.release()}`,
    cpus: os.cpus().length,
    totalMB: Math.round(os.totalmem() / 1024 ** 2),
  });

  powerMonitor.on("suspend", () => void write({ kind: "power", event: "suspend" }));
  powerMonitor.on("resume", () => void write({ kind: "power", event: "resume" }));
  powerMonitor.on("lock-screen", () => void write({ kind: "power", event: "lock-screen" }));
  powerMonitor.on("unlock-screen", () => void write({ kind: "power", event: "unlock-screen" }));
  powerMonitor.on("thermal-state-change", (d: { state: string }) => void write({ kind: "thermal", state: d.state }));
  powerMonitor.on("speed-limit-change", (d: { limit: number }) => void write({ kind: "speed-limit", limit: d.limit }));

  lastTick = Date.now();
  timer = setInterval(() => void sample(), SAMPLE_MS);
  timer.unref();
}

export async function stopSystemMonitor(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  await write({ kind: "stop" });
}
