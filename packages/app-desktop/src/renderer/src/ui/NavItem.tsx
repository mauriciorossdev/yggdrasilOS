import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; icon?: ReactNode };

/** One row of a vertical navigation list (the sidebar's main sections). */
export function NavItem({ active, icon, className, type = "button", children, ...rest }: Props) {
  const classes = ["ygg-nav-item", active && "ygg-nav-item--active", className].filter(Boolean).join(" ");
  return (
    <button type={type} aria-current={active ? "page" : undefined} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
}
