/**
 * Standalone entry (built by electron-vite as its own bundle — see
 * electron.vite.config.ts's `main.build.rollupOptions.input` — so it can be
 * invoked as `node <resolved path> <controlUrl> <controlToken>` independent
 * of Electron itself). Configured as this project's `statusLine` command
 * (see statuslineConfig.ts) — Claude Code spawns this fresh on every status
 * tick and pipes a JSON session-state blob to stdin, including a
 * `rate_limits` window (Claude.ai Pro/Max session + weekly usage — see
 * https://code.claude.com/docs/en/statusline). Forwards just that window to
 * paneControlServer.ts's local HTTP API so the desktop app can show it in
 * TerminalNavbar.tsx, and also prints a plain status line to stdout so the
 * pane itself keeps showing useful info (Claude Code drops its own default
 * footer once a custom statusLine is configured).
 *
 * Best-effort throughout: a failed POST (app not running, or a stale port
 * left over from a prior app run) must never make this pane's status line
 * go blank or throw — falls back to printing model/context info alone, same
 * as paneControlMcpShim.ts's posture toward its own control-server calls.
 */

const [, , controlUrl, controlToken] = process.argv;

type RateLimitWindow = { used_percentage?: number; resets_at?: number };
type StatuslinePayload = {
  model?: { display_name?: string };
  context_window?: { used_percentage?: number | null };
  rate_limits?: { five_hour?: RateLimitWindow; seven_day?: RateLimitWindow };
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function toWindow(w: RateLimitWindow | undefined): { usedPercentage: number; resetsAt: number } | undefined {
  if (!w || typeof w.used_percentage !== "number" || typeof w.resets_at !== "number") return undefined;
  return { usedPercentage: w.used_percentage, resetsAt: w.resets_at };
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let data: StatuslinePayload = {};
  try {
    data = JSON.parse(raw) as StatuslinePayload;
  } catch {
    // Malformed/empty stdin — still print something rather than nothing.
  }

  const fiveHour = toWindow(data.rate_limits?.five_hour);
  const sevenDay = toWindow(data.rate_limits?.seven_day);

  if (controlUrl && controlToken && (fiveHour || sevenDay)) {
    try {
      await fetch(`${controlUrl}/statusline`, {
        method: "POST",
        headers: { authorization: `Bearer ${controlToken}`, "content-type": "application/json" },
        body: JSON.stringify({ fiveHour, sevenDay }),
      });
    } catch {
      // App may be closed or mid-restart (stale port) — the pane's own
      // status line below still renders fine without it.
    }
  }

  const parts: string[] = [];
  if (data.model?.display_name) parts.push(data.model.display_name);
  if (typeof data.context_window?.used_percentage === "number") {
    parts.push(`ctx ${Math.round(data.context_window.used_percentage)}%`);
  }
  if (fiveHour) parts.push(`5h ${Math.round(fiveHour.usedPercentage)}%`);
  if (sevenDay) parts.push(`7d ${Math.round(sevenDay.usedPercentage)}%`);
  process.stdout.write(parts.join(" · "));
}

void main().catch(() => {
  // Never let a bug here surface as a broken/blank status line in the pane.
});
