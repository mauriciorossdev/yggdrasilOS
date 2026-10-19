import { readdir } from "node:fs/promises";
import { defineTool } from "@yggdrasil/tools-sdk";
import { execAsync, EXEC_OPTS } from "./exec.js";

const MAX_ROWS = 50;

export const listProcessesTool = defineTool({
  name: "list_processes",
  description: "Lists currently running processes (name, pid, cpu%, mem%) on this machine.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute() {
    if (process.platform === "win32") {
      const { stdout } = await execAsync("tasklist /fo csv /nh", EXEC_OPTS);
      const rows = stdout
        .trim()
        .split(/\r?\n/)
        .slice(0, MAX_ROWS)
        .map((line) => {
          const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ""));
          return { name: cols[0], pid: cols[1], memUsage: cols[4] };
        });
      return { platform: "win32", processes: rows };
    }

    try {
      const { stdout } = await execAsync("ps -eo pid,comm,pcpu,pmem --no-headers", EXEC_OPTS);
      const rows = stdout
        .trim()
        .split(/\r?\n/)
        .slice(0, MAX_ROWS)
        .map((line) => {
          const [pid, comm, cpu, mem] = line.trim().split(/\s+/);
          return { pid, name: comm, cpuPercent: cpu, memPercent: mem };
        });
      return { platform: process.platform, processes: rows };
    } catch {
      const { stdout } = await execAsync("ps -eo pid,comm,pcpu,pmem", EXEC_OPTS);
      const rows = stdout
        .trim()
        .split(/\r?\n/)
        .slice(1, MAX_ROWS + 1)
        .map((line) => {
          const [pid, comm, cpu, mem] = line.trim().split(/\s+/);
          return { pid, name: comm, cpuPercent: cpu, memPercent: mem };
        });
      return { platform: process.platform, processes: rows };
    }
  },
});

export const listInstalledAppsTool = defineTool({
  name: "list_installed_apps",
  description: "Lists installed applications/packages on this machine (Windows registry, macOS /Applications, or Linux package manager).",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute() {
    if (process.platform === "win32") {
      const cmd =
        "powershell -NoProfile -Command \"Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName,DisplayVersion | ConvertTo-Json -Compress\"";
      const { stdout } = await execAsync(cmd, EXEC_OPTS);
      const parsed = JSON.parse(stdout.trim() || "[]");
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return {
        platform: "win32",
        apps: list.slice(0, 200).map((a: { DisplayName?: string; DisplayVersion?: string }) => ({
          name: a.DisplayName,
          version: a.DisplayVersion,
        })),
      };
    }

    if (process.platform === "darwin") {
      const entries = await readdir("/Applications");
      return {
        platform: "darwin",
        apps: entries.filter((e) => e.endsWith(".app")).map((e) => ({ name: e.replace(/\.app$/, "") })),
      };
    }

    try {
      const { stdout } = await execAsync("dpkg -l", EXEC_OPTS);
      const rows = stdout
        .trim()
        .split(/\r?\n/)
        .slice(5, 205)
        .map((line) => {
          const cols = line.trim().split(/\s+/);
          return { name: cols[1], version: cols[2] };
        });
      return { platform: "linux", apps: rows };
    } catch {
      try {
        const { stdout } = await execAsync("rpm -qa", EXEC_OPTS);
        const rows = stdout
          .trim()
          .split(/\r?\n/)
          .slice(0, 200)
          .map((name) => ({ name }));
        return { platform: "linux", apps: rows };
      } catch {
        return { platform: process.platform, apps: [], error: "No supported package manager found (tried dpkg, rpm)" };
      }
    }
  },
});
