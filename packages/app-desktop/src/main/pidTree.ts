import { execFile } from "node:child_process";

/** "pid,ppid" per line → pid → parent pid. Lines that aren't two positive integers are skipped. */
export function parsePidTable(output: string): Map<number, number> {
  const table = new Map<number, number>();
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(line);
    if (m && Number(m[1]) > 0) table.set(Number(m[1]), Number(m[2]));
  }
  return table;
}

const TABLE_TTL_MS = 3000;
let cached: { at: number; table: Map<number, number> } | null = null;

/**
 * Windows has no `ps -o ppid=`: ask Windows PowerShell for every process's
 * parent once (cached briefly, the Worktrees view asks for a few pids per
 * refresh). Undefined when PowerShell can't run or answers nothing usable.
 */
export function readWindowsPidTable(): Promise<Map<number, number> | undefined> {
  if (cached && Date.now() - cached.at < TABLE_TTL_MS) return Promise.resolve(cached.table);
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { '{0},{1}' -f $_.ProcessId, $_.ParentProcessId }",
      ],
      { timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        const table = err ? new Map<number, number>() : parsePidTable(stdout);
        if (table.size === 0) return resolve(undefined);
        cached = { at: Date.now(), table };
        resolve(table);
      },
    );
  });
}
