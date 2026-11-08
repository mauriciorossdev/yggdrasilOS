import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import type { LspChannel } from "./manager.js";
import type { LspLaunch } from "./servers.js";

const STDERR_TAIL_CHARS = 2000;

/** Ends a server and anything it started; killing only the parent would orphan tsserver. */
function killTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      // Detached at spawn, so the server leads its own process group.
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Already gone.
  }
}

function stdioChannel(launch: Exclude<LspLaunch, { kind: "tcp" }>, cwd: string): LspChannel {
  const isScript = launch.kind === "script";
  const child = spawn(isScript ? process.execPath : launch.command, isScript ? [launch.script, ...launch.args] : launch.args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
    env: { ...process.env, ...(isScript ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
  });
  // A dying server breaks the pipe; the close handler below is what reports that.
  child.stdin.on("error", () => {});
  let closed = false;
  let killed = false;
  const closers: Array<(reason: string | null) => void> = [];
  const finish = (reason: string | null) => {
    if (closed) return;
    closed = true;
    for (const closer of closers) closer(reason);
  };
  child.on("error", (err) => finish(err.message));
  child.on("exit", (code) => finish(code ? stderr.trim() || `exit code ${code}` : null));
  return {
    ownsServer: true,
    write: (data) => void child.stdin.write(data),
    onData: (handler) => void child.stdout.on("data", handler),
    onClose: (handler) => {
      if (closed) handler(null);
      else closers.push(handler);
    },
    kill: () => {
      if (killed || child.pid === undefined) return;
      killed = true;
      killTree(child.pid);
    },
  };
}

function tcpChannel(launch: Extract<LspLaunch, { kind: "tcp" }>): LspChannel {
  const socket = connect({ host: launch.host, port: launch.port });
  let closed = false;
  let lastError: string | null = null;
  const closers: Array<(reason: string | null) => void> = [];
  socket.on("error", (err) => {
    lastError = err.message;
  });
  socket.on("close", () => {
    if (closed) return;
    closed = true;
    for (const closer of closers) closer(lastError);
  });
  return {
    ownsServer: false,
    write: (data) => void socket.write(data),
    onData: (handler) => void socket.on("data", handler),
    onClose: (handler) => {
      if (closed) handler(lastError);
      else closers.push(handler);
    },
    kill: () => void socket.destroy(),
  };
}

export function openChannel(launch: LspLaunch, cwd: string): LspChannel {
  return launch.kind === "tcp" ? tcpChannel(launch) : stdioChannel(launch, cwd);
}
