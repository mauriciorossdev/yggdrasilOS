import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

/** The standard text button. `primary` is the one filled-accent action per surface. */
export function Button({ variant = "secondary", size = "md", className, type = "button", children, ...rest }: Props) {
  const classes = ["ygg-btn", `ygg-btn--${variant}`, `ygg-btn--${size}`, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
