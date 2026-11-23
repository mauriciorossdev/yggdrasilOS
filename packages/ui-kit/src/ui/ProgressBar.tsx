import type { ChipTone } from "./Chip.js";

type Props = {
  /** 0 to 1; clamped. */
  value: number;
  tone?: Extract<ChipTone, "working" | "checking" | "ready" | "danger"> | "accent";
  label?: string;
  className?: string;
};

export function ProgressBar({ value, tone = "accent", label, className }: Props) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className={["ygg-progress", tone !== "accent" && `ygg-progress--${tone}`, className].filter(Boolean).join(" ")}
    >
      <span className="ygg-progress__fill" style={{ width: `${pct}%` }} />
    </span>
  );
}
