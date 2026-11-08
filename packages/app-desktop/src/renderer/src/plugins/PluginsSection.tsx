import { useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/20/solid";
import type { PluginRecord } from "../types.js";
import { CollapsibleSection } from "../components/CollapsibleSection.js";
import { PluginContextMenu } from "./PluginContextMenu.js";
import { ShareDialog } from "../sync/ShareDialog.js";
import type { ResourceRef } from "../types.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  plugins: PluginRecord[];
  onOpen: (key: string) => void;
  onOpenTab: (key: string) => void;
  onOpenPanel: (key: string) => void;
  onReload: () => void;
};

type MenuState = { plugin: PluginRecord; x: number; y: number };

export function PluginsSection({ plugins, onOpen, onOpenTab, onOpenPanel, onReload }: Props) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [shareTarget, setShareTarget] = useState<{ ref: ResourceRef; label: string } | null>(null);

  // v1: only kanban's board is offered a "Compartir…" affordance — the host
  // chrome doesn't generally know which of a plugin's storage keys holds
  // "the" shareable thing (see syncEngine.ts's plugin-storage-key resource
  // type, and the plan doc's Fase 4 note on this default). Other plugins can
  // still be shared by hand later without any code change here — this is
  // just which ones get a menu shortcut.
  const shareRefFor = (plugin: PluginRecord): ResourceRef | null => {
    if (plugin.manifest.id !== "kanban" || !window.yggdrasil.projectId) return null;
    return {
      resourceType: "plugin-storage-key",
      projectId: window.yggdrasil.projectId,
      scope: plugin.scope,
      pluginId: plugin.manifest.id,
      storageKey: `kanban_board_${window.yggdrasil.projectId}`,
    };
  };

  // Drafts (Estudio) are hidden here on purpose — they're only visible/manageable in the Estudio tab until "Publicar" flips their status.
  const visible = plugins.filter((p) => p.manifest.status !== "draft");

  return (
    <CollapsibleSection
      title={t("plugins.section.title")}
      id="plugins"
      count={visible.length}
      defaultOpen
      actions={
        <button type="button" className="icon-btn" title={t("plugins.section.reload")} onClick={onReload}>
          <ArrowPathIcon className="hero-icon" />
        </button>
      }
    >
      {visible.length > 0 ? (
        <div className="plugin-strip">
          {visible.map((p) => {
            const name = p.manifest.name;
            const detail = p.error ?? `v${p.manifest.version} — ${p.dir}`;
            return (
              <button
                key={p.key}
                type="button"
                className={`plugin-strip-btn${p.error ? " error" : p.scope === "project" ? " project" : ""}`}
                onClick={() => onOpen(p.key)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ plugin: p, x: e.clientX, y: e.clientY });
                }}
                disabled={!!p.error}
                aria-label={name}
                title={`${name}${p.scope === "project" ? t("plugins.section.projectSuffix") : ""}\n${detail}`}
              >
                {p.manifest.icon && !p.manifest.icon.includes(".") ? p.manifest.icon : "🧩"}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted plugin-empty">{t("plugins.section.empty")}</p>
      )}

      {menu && (
        <PluginContextMenu
          plugin={menu.plugin}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpenTab={() => onOpenTab(menu.plugin.key)}
          onOpenPanel={() => onOpenPanel(menu.plugin.key)}
          onReload={onReload}
          onReveal={() => void window.yggdrasil.plugins.reveal(menu.plugin.dir)}
          onShare={
            shareRefFor(menu.plugin)
              ? () => setShareTarget({ ref: shareRefFor(menu.plugin)!, label: menu.plugin.manifest.name })
              : undefined
          }
        />
      )}

      {shareTarget && (
        <ShareDialog
          resourceRef={shareTarget.ref}
          title={t("plugins.section.shareTitle", { label: shareTarget.label })}
          onClose={() => setShareTarget(null)}
        />
      )}
    </CollapsibleSection>
  );
}
