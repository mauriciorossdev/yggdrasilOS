import type { ReactNode } from "react";
import { useI18n, type MessageKey } from "../i18n/index.js";

export type ChipTone = "neutral" | "accent" | "working" | "checking" | "ready" | "attention" | "danger";

type ChipProps = {
  tone?: ChipTone;
  /** A small leading dot in the chip's color: marks a live state ("working"), not a count. */
  dot?: boolean;
  title?: string;
  /** Makes the chip a button (e.g. the pane's feature-doc chip opens the doc). */
  onClick?: () => void;
  className?: string;
  children: ReactNode;
};

export function Chip({ tone = "neutral", dot, title, onClick, className, children }: ChipProps) {
  const classes = ["ygg-chip", `ygg-chip--${tone}`, className].filter(Boolean).join(" ");
  const content = (
    <>
      {dot && <span className="ygg-chip__dot" aria-hidden />}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className={classes} title={title} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className={classes} title={title}>
      {content}
    </span>
  );
}

/** The status a feature doc declares (`Status:` line, see documents/featureDoc.ts). */
export type FeatureStatus = "working" | "checking" | "ready" | "needs-decision";

export const STATUS_TONE: Record<FeatureStatus, ChipTone> = {
  working: "working",
  checking: "checking",
  ready: "ready",
  "needs-decision": "attention",
};

export function statusTone(status: FeatureStatus | null | undefined): ChipTone {
  return status ? STATUS_TONE[status] : "neutral";
}

const STATUS_LABEL: Record<FeatureStatus, MessageKey> = {
  working: "term.spec.working",
  checking: "term.spec.checking",
  ready: "term.spec.ready",
  "needs-decision": "term.spec.needsDecision",
};

export function StatusChip({ status, children, ...rest }: Omit<ChipProps, "tone" | "children"> & { status: FeatureStatus; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <Chip tone={STATUS_TONE[status]} {...rest}>
      {children ?? t(STATUS_LABEL[status])}
    </Chip>
  );
}
