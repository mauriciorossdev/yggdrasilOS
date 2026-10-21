import { useEffect, useState } from "react";
import type { RateLimitsPayload } from "../types.js";

function formatResetTime(resetsAt: number): string {
  return new Date(resetsAt * 1000).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Meter({ label, percent }: { label: string; percent: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <span className="claude-usage-meter">
      {label}
      <span className="claude-usage-bar" aria-hidden>
        <span className="claude-usage-fill" style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}

/**
 * Claude Code's own session (5h) / weekly (7d) rate-limit usage, sourced
 * from whichever `claude` pane last reported a status tick (see
 * statuslineBridge.ts and paneControlServer.ts's /statusline route). Lives in
 * the top bar: this data is account-wide, not scoped to the Terminal tab, and
 * owns its own IPC subscription rather than being threaded through as a prop.
 */
export function ClaudeUsage() {
  const [rateLimits, setRateLimits] = useState<RateLimitsPayload | undefined>();

  useEffect(() => {
    let cancelled = false;
    void window.yggdrasil.statusline.get().then((initial) => {
      if (!cancelled && initial) setRateLimits(initial);
    });
    const unsubscribe = window.yggdrasil.statusline.onUpdate((payload) => setRateLimits(payload));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (!rateLimits?.fiveHour && !rateLimits?.sevenDay) return null;

  const title = [
    rateLimits.fiveHour && `Session resets ${formatResetTime(rateLimits.fiveHour.resetsAt)}`,
    rateLimits.sevenDay && `Week resets ${formatResetTime(rateLimits.sevenDay.resetsAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span className="claude-usage" title={title}>
      {rateLimits.fiveHour && <Meter label="5h" percent={rateLimits.fiveHour.usedPercentage} />}
      {rateLimits.sevenDay && <Meter label="7d" percent={rateLimits.sevenDay.usedPercentage} />}
    </span>
  );
}
