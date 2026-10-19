import { useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/20/solid";
import type { PluginRecord } from "../types.js";
import { CollapsibleSection } from "../components/CollapsibleSection.js";
import { PluginContextMenu } from "./PluginContextMenu.js";
import { ShareDialog } from "../sync/ShareDialog.js";
import type { ResourceRef } from "../types.js";

type Props = {
  plugins: PluginRecord[];
  onOpen: (key: string) => void;
  onOpenTab: (key: string) => void;
  onOpenPanel: (key: string) => void;
  onReload: () => void;
};

type MenuState = { plugin: PluginRecord; x: number; y: number };

export function PluginsSection({ plugins, onOpen, onOpenTab, onOpenPanel, onReload }: Props) {
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

  return (
    <CollapsibleSection
      title="Complementos"
      defaultOpen
      actions={
        <button type="button" className="icon-btn" title="Recargar complementos" onClick={onReload}>
          <ArrowPathIcon className="hero-icon" />
        </button>
      }
    >
      <ul>
        {/* Drafts (Estudio) are hidden here on purpose — they're only visible/manageable in the Estudio tab until "Publicar" flips their status. */}
        {plugins.filter((p) => p.manifest.status !== "draft").map((p) => (
          <li key={p.key}>
            <button
              type="button"
              className="session-item"
              onClick={() => onOpen(p.key)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ plugin: p, x: e.clientX, y: e.clientY });
              }}
              disabled={!!p.error}
              title={p.error ?? `v${p.manifest.version} — ${p.dir}`}
            >
              <span className="plugin-icon">
                {p.manifest.icon && !p.manifest.icon.includes(".") ? p.manifest.icon : "🧩"}
              </span>
              {p.manifest.name}
              {p.scope === "global" && <span className="scope-tag">global</span>}
              {p.error && <span className="scope-tag plugin-error-tag">error</span>}
            </button>
          </li>
        ))}
        {plugins.filter((p) => p.manifest.status !== "draft").length === 0 && (
          <li className="muted">Sin complementos — pide a un agente: «crea un complemento para…»</li>
        )}
      </ul>

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
          title={`Compartir "${shareTarget.label}"`}
          onClose={() => setShareTarget(null)}
        />
      )}
    </CollapsibleSection>
  );
}
