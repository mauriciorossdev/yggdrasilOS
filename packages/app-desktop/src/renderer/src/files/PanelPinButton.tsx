import { MapPinIcon } from "@heroicons/react/20/solid";
import { useI18n } from "../i18n/index.js";

/** Switches the side panel between floating over the content and taking its own column. */
export function PanelPinButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const label = pinned ? t("doc.panel.unpin") : t("doc.panel.pin");
  return (
    <button
      type="button"
      className={pinned ? "icon-btn panel-pin-btn active" : "icon-btn panel-pin-btn"}
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={pinned}
    >
      <MapPinIcon className="hero-icon" />
    </button>
  );
}
