import { useCallback, useEffect, useState } from "react";
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  CodeBracketIcon,
  HomeIcon,
  MinusIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { SettingsView } from "../settings/SettingsView.js";
import { ClaudeUsage } from "./ClaudeUsage.js";
import { useActiveTab, useExtraTabs, viewLabel } from "../ui/mainTabsStore.js";

/**
 * Every project window is frameless (main/index.ts's createProjectBrowserWindow
 * sets frame:false on all platforms) — this is the OS chrome's replacement:
 * drag region, project/gateway info that used to live in the native title
 * bar text, and the minimize/maximize/close buttons the OS would otherwise
 * have drawn.
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [borderColor, setBorderColor] = useState(window.yggdrasil.projectColor);
  // null = no IDE configured yet (button falls back to opening Settings on
  // the IDE section); a string = the configured IDE's display label, used
  // for the button's tooltip only.
  const [ideLabel, setIdeLabel] = useState<string | null>(null);
  const [showIdeSettings, setShowIdeSettings] = useState(false);

  useEffect(() => {
    window.yggdrasil.window.isMaximized().then(setMaximized);
    return window.yggdrasil.window.onMaximizedChange(setMaximized);
  }, []);

  const refreshIdeLabel = useCallback(() => {
    void Promise.all([window.yggdrasil.ide.getSettings(), window.yggdrasil.ide.listCatalog()]).then(
      ([settings, catalog]) => {
        if (!settings.configuredId) return setIdeLabel(null);
        if (settings.configuredId === "custom") return setIdeLabel(settings.customLabel || "Custom IDE");
        setIdeLabel(catalog.find((c) => c.id === settings.configuredId)?.label ?? null);
      },
    );
  }, []);

  useEffect(() => {
    if (window.yggdrasil.projectId) refreshIdeLabel();
  }, [refreshIdeLabel]);

  // Opens the configured IDE at this project's path; falls back to Settings
  // → IDE (pre-scrolled there via initialSection) when nothing is configured
  // yet, or the configured one is no longer installed — see main/ideSettings.ts.
  const openIde = async () => {
    const result = await window.yggdrasil.ide.openProject();
    if (!result.opened) {
      if (result.error) window.alert(result.error);
      setShowIdeSettings(true);
    }
  };

  useEffect(
    () =>
      window.yggdrasil.projects.onColorChange((id, color) => {
        if (id === window.yggdrasil.projectId) setBorderColor(color);
      }),
    [],
  );

  useEffect(() => {
    // No project color: drop the inline override so tokens.css defaults apply
    // (the accent default follows the user's theme).
    const root = document.documentElement.style;
    if (borderColor) {
      root.setProperty("--project-border-color", borderColor);
      root.setProperty("--project-accent-color", borderColor);
    } else {
      root.removeProperty("--project-border-color");
      root.removeProperty("--project-accent-color");
    }
  }, [borderColor]);

  const projectId = window.yggdrasil.projectId;
  const activeTab = useActiveTab();
  const extraTabs = useExtraTabs();

  return (
    <div className="title-bar">
      <div className="title-bar-drag">
        <span className="title-bar-project">{window.yggdrasil.projectName ?? "Yggdrasil"}</span>
        <span className="title-bar-view">/ {viewLabel(activeTab, extraTabs)}</span>
        {window.yggdrasil.gatewayLanUrl && (
          <span className="title-bar-gateway">{window.yggdrasil.gatewayLanUrl}</span>
        )}
        {projectId && (
          <span className="title-bar-color-swatch-wrap">
            <span className="title-bar-color-swatch" style={{ background: borderColor || undefined }} />
            <input
              type="color"
              className="title-bar-color-input"
              title="Project border color"
              value={borderColor || "#000000"}
              onChange={(e) => {
                setBorderColor(e.target.value);
                void window.yggdrasil.projects.setColor(projectId, e.target.value);
              }}
            />
            {borderColor && (
              <button
                type="button"
                className="title-bar-color-clear"
                title="Clear border color"
                onClick={() => {
                  setBorderColor(null);
                  void window.yggdrasil.projects.setColor(projectId, null);
                }}
              >
                <XMarkIcon className="hero-icon" />
              </button>
            )}
          </span>
        )}
      </div>
      <div className="title-bar-controls">
        <ClaudeUsage />
        {!window.yggdrasil.isDefaultProject && (
          <button
            type="button"
            className="title-bar-btn"
            title="Home — main window"
            onClick={() => void window.yggdrasil.projects.openHome()}
          >
            <HomeIcon className="hero-icon" />
          </button>
        )}
        {projectId && (
          <button
            type="button"
            className="title-bar-btn title-bar-ide-btn"
            title={ideLabel ? `Open in ${ideLabel}` : "Configure IDE"}
            onClick={() => void openIde()}
          >
            <CodeBracketIcon className="hero-icon" />
            IDE
          </button>
        )}
        <button
          type="button"
          className="title-bar-btn"
          title="Minimize"
          onClick={() => void window.yggdrasil.window.minimize()}
        >
          <MinusIcon className="hero-icon" />
        </button>
        <button
          type="button"
          className="title-bar-btn"
          title={maximized ? "Restore" : "Maximize"}
          onClick={() => void window.yggdrasil.window.toggleMaximize()}
        >
          {maximized ? <ArrowsPointingInIcon className="hero-icon" /> : <ArrowsPointingOutIcon className="hero-icon" />}
        </button>
        <button
          type="button"
          className="title-bar-btn title-bar-close"
          title="Close"
          onClick={() => void window.yggdrasil.window.close()}
        >
          <XMarkIcon className="hero-icon" />
        </button>
      </div>

      {showIdeSettings && (
        <SettingsView
          initialSection="ide"
          onClose={() => {
            setShowIdeSettings(false);
            refreshIdeLabel();
          }}
        />
      )}
    </div>
  );
}
