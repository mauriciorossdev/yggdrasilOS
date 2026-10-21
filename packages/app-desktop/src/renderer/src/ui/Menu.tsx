import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useDismiss } from "./useDismiss.js";

type MenuProps = {
  /** Anchor in viewport coordinates (a click position or a button's rect corner). */
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
};

/** A floating popup menu at (x, y), kept inside the window, closed by Escape or a click outside. */
export function Menu({ x, y, onClose, children }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useDismiss(ref, onClose);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

  return (
    <div className="ygg-menu" ref={ref} role="menu" style={pos}>
      {children}
    </div>
  );
}

type ItemProps = ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean };

export function MenuItem({ danger, className, type = "button", ...rest }: ItemProps) {
  const classes = ["ygg-menu__item", danger && "ygg-menu__item--danger", className].filter(Boolean).join(" ");
  return <button type={type} role="menuitem" className={classes} {...rest} />;
}

export function MenuSeparator() {
  return <div className="ygg-menu__separator" role="separator" />;
}
