import { XMarkIcon } from "@heroicons/react/20/solid";
import { useI18n } from "../i18n/index.js";

export type PanelTabInfo = { key: string; label: string; title?: string };

type Props = {
  tabs: PanelTabInfo[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onCloseAll?: () => void;
};

/** The aside's tab strip. Hidden for a single tab: the panel's own header already says what it is. */
export function PanelTabs({ tabs, activeKey, onActivate, onClose, onCloseAll }: Props) {
  const { t } = useI18n();
  if (tabs.length < 2) return null;
  return (
    <div className="panel-tabs" role="tablist">
      {tabs.map((tab) => (
        <div key={tab.key} className={`panel-tab${tab.key === activeKey ? " active" : ""}`}>
          <button
            type="button"
            role="tab"
            aria-selected={tab.key === activeKey}
            className="panel-tab-label"
            title={tab.title ?? tab.label}
            onClick={() => onActivate(tab.key)}
          >
            {tab.label}
          </button>
          <button
            type="button"
            className="panel-tab-close"
            aria-label={t("chat.panel.closeTab")}
            title={t("chat.panel.closeTab")}
            onClick={() => onClose(tab.key)}
          >
            <XMarkIcon className="hero-icon" />
          </button>
        </div>
      ))}
      {onCloseAll && (
        <button type="button" className="panel-tabs-closeall" onClick={onCloseAll}>
          {t("chat.panel.closeAll")}
        </button>
      )}
    </div>
  );
}
