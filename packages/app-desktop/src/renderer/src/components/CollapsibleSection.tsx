import { useState, type ReactNode } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";

type Props = {
  title: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function CollapsibleSection({ title, defaultOpen = false, actions, children, className }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`sidebar-section collapsible ${open ? "open" : "closed"} ${className ?? ""}`}>
      <div className="collapsible-header">
        <button type="button" className="collapsible-toggle" onClick={() => setOpen((o) => !o)}>
          <span className={`chevron ${open ? "open" : ""}`}>
            <ChevronRightIcon className="hero-icon" />
          </span>
          <span className="sidebar-label">{title}</span>
        </button>
        {actions}
      </div>
      <div className={`collapsible-body-shell ${open ? "open" : ""}`}>
        <div className="collapsible-body">{children}</div>
      </div>
    </div>
  );
}
