import { XMarkIcon } from "@heroicons/react/20/solid";
import type { CSSProperties } from "react";
import type { PluginRecord } from "../types.js";
import { PluginFrame } from "./PluginFrame.js";

type Props = {
  plugin: PluginRecord;
  version: number;
  onClose: () => void;
  onOpenFile?: (relativePath: string) => void;
  onOpenTab?: (tab: string) => void;
  style?: CSSProperties;
  /** Extra class alongside "file-content-panel" — e.g. "file-content-panel-drawer" for the Terminal-tab overlay mode. Same convention as FileContentPanel.tsx. */
  className?: string;
};

/** The aside/drawer equivalent of PluginFrame's MainTabs tab — same outer shell (and CSS classes) as FileContentPanel, so ChatView can swap between the two without any layout changes. */
export function PluginPanel({ plugin, version, onClose, onOpenFile, onOpenTab, style, className }: Props) {
  return (
    <aside className={`file-content-panel${className ? ` ${className}` : ""}`} style={style}>
      <div className="file-content-panel-header">
        <div className="file-content-panel-title">
          <span className="file-content-panel-path" title={plugin.manifest.name}>
            {plugin.manifest.icon && !plugin.manifest.icon.includes(".") ? `${plugin.manifest.icon} ` : ""}
            {plugin.manifest.name}
          </span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} title="Close">
          <XMarkIcon className="hero-icon" />
        </button>
      </div>
      <div className="file-content-panel-body plugin-panel-body">
        <PluginFrame plugin={plugin} version={version} visible onOpenFile={onOpenFile} onOpenTab={onOpenTab} />
      </div>
    </aside>
  );
}
