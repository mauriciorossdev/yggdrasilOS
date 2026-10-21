import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
  /** Required: an icon-only button has no text, so the label is its accessible name and its tooltip. */
  label: string;
  children: ReactNode;
};

export function IconButton({ label, className, type = "button", children, ...rest }: Props) {
  return (
    <button type={type} aria-label={label} title={label} className={["ygg-icon-btn", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </button>
  );
}
