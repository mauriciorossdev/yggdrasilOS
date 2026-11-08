import { useState, type ReactNode } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { initialSectionOpen, saveSectionState } from "../ui/sidebarSections.js";

/** Sections are remembered per project; the default project (no id) shares one bucket. */
const projectKey = (): string => window.yggdrasil.projectId ?? "default";

type Props = {
  title: string;
  /** Remembers whether the user left this section open (per project). Omitted = not remembered. */
  id?: string;
  defaultOpen?: boolean;
  /** Controls for the section. Shown while it is open and when its header is hovered or focused; hidden otherwise, so a closed row stays a single quiet line. */
  actions?: ReactNode;
  /** How many items the section holds, shown at the end of the row while it is closed. Zero shows nothing. */
  count?: number;
  /** An alert-style number (e.g. git changes) shown as a pill instead of plain text. Zero shows nothing. */
  badge?: number;
  children: ReactNode;
  className?: string;
};

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function CollapsibleSection({ title, id, defaultOpen = false, actions, count, badge, children, className }: Props) {
  const [open, setOpen] = useState(() => initialSectionOpen(storage(), projectKey(), id, defaultOpen));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (id) saveSectionState(storage(), projectKey(), id, next);
  };
  const summary = badge ? (
    <span className="collapsible-badge">{badge > 99 ? "99+" : badge}</span>
  ) : count ? (
    <span className="collapsible-count">{count}</span>
  ) : null;

  return (
    <div className={`sidebar-section collapsible ${open ? "open" : "closed"}${actions ? " has-actions" : ""} ${className ?? ""}`}>
      <div className="collapsible-header">
        <button type="button" className="collapsible-toggle" aria-expanded={open} onClick={toggle}>
          <span className={`chevron ${open ? "open" : ""}`}>
            <ChevronRightIcon className="hero-icon" />
          </span>
          <span className="sidebar-label">{title}</span>
        </button>
        {(summary || actions) && (
          <div className="collapsible-end">
            {summary && <span className="collapsible-summary">{summary}</span>}
            {actions && <div className="collapsible-actions-wrap">{actions}</div>}
          </div>
        )}
      </div>
      <div className={`collapsible-body-shell ${open ? "open" : ""}`}>
        <div className="collapsible-body">{children}</div>
      </div>
    </div>
  );
}
