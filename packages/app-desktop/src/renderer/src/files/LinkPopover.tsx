import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/index.js";

type Props = {
  /** The link's current address, or empty when the cursor isn't on one. */
  initialHref: string;
  onApply: (href: string) => void;
  onClose: () => void;
};

/**
 * Small address box under the toolbar's link button. Electron has no
 * window.prompt(), so this stands in for it: Enter applies, Escape closes,
 * and an empty address removes the link.
 */
export function LinkPopover({ initialHref, onApply, onClose }: Props) {
  const { t } = useI18n();
  const [href, setHref] = useState(initialHref);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const apply = () => {
    onApply(href);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      apply();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="link-popover" ref={ref} role="dialog" aria-label={t("doc.link")}>
      <input
        autoFocus
        type="text"
        value={href}
        placeholder={t("doc.link.placeholder")}
        aria-label={t("doc.link.address")}
        spellCheck={false}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="link-popover-apply" onClick={apply}>
        {initialHref && !href.trim() ? t("doc.link.removeShort") : t("doc.link.apply")}
      </button>
      {initialHref && (
        <button
          type="button"
          onClick={() => {
            onApply("");
            onClose();
          }}
        >
          {t("doc.link.remove")}
        </button>
      )}
    </div>
  );
}
