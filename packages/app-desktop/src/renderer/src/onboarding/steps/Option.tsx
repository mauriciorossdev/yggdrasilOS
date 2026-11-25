import type { ReactNode } from "react";

type Props = {
  /** "radio": one of a group (round mark); "check": independent toggle (square mark). */
  kind: "radio" | "check";
  selected: boolean;
  onSelect: () => void;
  label: ReactNode;
  sub?: ReactNode;
  /** Small mono status on the right ("installed · v1.0"), optionally tinted. */
  meta?: ReactNode;
  metaTone?: "ok" | "warn";
  big?: boolean;
  disabled?: boolean;
};

/** One selectable row of the setup wizard (language, agents, models, editor). */
export function Option({ kind, selected, onSelect, label, sub, meta, metaTone, big, disabled }: Props) {
  return (
    <button
      type="button"
      className={`ob-opt ob-opt--${kind}${big ? " ob-opt--big" : ""}`}
      role={kind === "radio" ? "radio" : "checkbox"}
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="ob-opt-mark" aria-hidden />
      <span className="ob-opt-label">
        {label}
        {sub && <small>{sub}</small>}
      </span>
      {meta && <span className={`ob-opt-meta${metaTone ? ` ob-opt-meta--${metaTone}` : ""}`}>{meta}</span>}
    </button>
  );
}
