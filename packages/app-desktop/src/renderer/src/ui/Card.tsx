import type { HTMLAttributes, ReactNode } from "react";

type CommonProps = { accent?: boolean; children: ReactNode; className?: string };

function cardClasses({ accent, className }: Pick<CommonProps, "accent" | "className">, interactive: boolean): string {
  return ["ygg-card", accent && "ygg-card--accent", interactive && "ygg-card--interactive", className].filter(Boolean).join(" ");
}

/** A surface that groups related content. Pass `onClick` to render it as a button. */
export function Card({
  accent,
  className,
  children,
  onClick,
  title,
  ...rest
}: CommonProps & Omit<HTMLAttributes<HTMLElement>, "children" | "className"> & { onClick?: () => void }) {
  if (onClick) {
    return (
      <button type="button" className={cardClasses({ accent, className }, true)} onClick={onClick} title={title}>
        {children}
      </button>
    );
  }
  return (
    <div className={cardClasses({ accent, className }, false)} title={title} {...rest}>
      {children}
    </div>
  );
}
