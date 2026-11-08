import { XMarkIcon } from "@heroicons/react/20/solid";
import type { CSSProperties, ReactNode } from "react";
import type { PluginRecord } from "../types.js";
import { PluginFrame } from "./PluginFrame.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  plugin: PluginRecord;
  version: number;
  onClose: () => void;
  /** Extra controls in the header, before Close. Same as FileContentPanel.tsx. */
  headerActions?: ReactNode;
  onOpenFile?: (relativePath: string) => void;
  onOpenTab?: (tab: string) => void;
  style?: CSSProperties;
  /** Extra class alongside "file-content-panel" — e.g. "file-content-panel-drawer" for the Terminal-tab overlay mode. Same convention as FileContentPanel.tsx. */
  className?: string;
};

/** The aside/drawer equivalent of PluginFrame's MainTabs tab — same outer shell (and CSS classes) as FileContentPanel, so ChatView can swap between the two without any layout changes. */
export function PluginPanel({ plugin, version, onClose, headerActions, onOpenFile, onOpenTab, style, className }: Props) {
  const { t } = useI18n();
  return (
    <aside className={`file-content-panel${className ? ` ${className}` : ""}`} style={style}>
      <div className="file-content-panel-header">
        <div className="file-content-panel-title">
          <span className="file-content-panel-path" title={plugin.manifest.name}>
            {plugin.manifest.icon && !plugin.manifest.icon.includes(".") ? `${plugin.manifest.icon} ` : ""}
            {plugin.manifest.name}
          </span>
        </div>
        {headerActions}
        <button type="button" className="icon-btn" onClick={onClose} title={t("doc.close")}>
          <XMarkIcon className="hero-icon" />
        </button>
      </div>
      <div className="file-content-panel-body plugin-panel-body">
        <PluginFrame plugin={plugin} version={version} visible onOpenFile={onOpenFile} onOpenTab={onOpenTab} />
      </div>
    </aside>
  );
}
