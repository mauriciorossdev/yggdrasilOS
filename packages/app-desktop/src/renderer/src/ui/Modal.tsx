import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { IconButton } from "./IconButton.js";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Right-aligned action row (usually a secondary Cancel and a primary action). */
  footer?: ReactNode;
};

/** A centered dialog. Closes on Escape, the close button, or a click on the dim backdrop. */
export function Modal({ title, onClose, children, footer }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="ygg-modal-overlay" onClick={onClose}>
      <div
        className="ygg-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ygg-modal__header">
          <h2 className="ygg-modal__title">{title}</h2>
          <IconButton label="Cerrar" onClick={onClose}>
            <XMarkIcon className="hero-icon" />
          </IconButton>
        </div>
        {children}
        {footer && <div className="ygg-modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
