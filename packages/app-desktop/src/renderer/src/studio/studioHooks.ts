import { useCallback, useEffect, useRef, useState } from "react";
import type { PermissionLint, PluginFileEntry, PluginRecord } from "../types.js";

/** Debounce for bursts of plugins:changed while an agent writes several files. */
const CHANGE_DEBOUNCE_MS = 250;

/**
 * Calls `onChange` (debounced) whenever this complemento's files change on
 * disk — the main process's plugins:changed, for this plugin id or for
 * "all" (a manual reload, a status/manifest write).
 */
export function usePluginChanges(plugin: PluginRecord, onChange: () => void): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = window.yggdrasil.plugins.onChanged((p) => {
      if (p.pluginId && p.pluginId !== plugin.manifest.id) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), CHANGE_DEBOUNCE_MS);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [plugin.manifest.id]);
}

/**
 * The complemento's files, refreshed on every change. `openedAt` marks when
 * this workspace opened: files modified after it are "Últimos cambios".
 */
export function usePluginFiles(plugin: PluginRecord): { files: PluginFileEntry[]; openedAt: number; refresh: () => void } {
  const [files, setFiles] = useState<PluginFileEntry[]>([]);
  const [openedAt] = useState(() => Date.now());
  const refresh = useCallback(() => {
    window.yggdrasil.plugins
      .listFiles(plugin.scope, plugin.manifest.id)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [plugin.scope, plugin.manifest.id]);
  useEffect(refresh, [refresh]);
  usePluginChanges(plugin, refresh);
  return { files, openedAt, refresh };
}

/** Declared-vs-used permissions (main/plugins.ts's lintPluginPermissions), refreshed on every change. */
export function usePermissionLint(plugin: PluginRecord): { lint: PermissionLint | null; refresh: () => void } {
  const [lint, setLint] = useState<PermissionLint | null>(null);
  const refresh = useCallback(() => {
    window.yggdrasil.plugins
      .lintPermissions(plugin.scope, plugin.manifest.id)
      .then(setLint)
      .catch(() => setLint(null));
  }, [plugin.scope, plugin.manifest.id]);
  useEffect(refresh, [refresh]);
  usePluginChanges(plugin, refresh);
  return { lint, refresh };
}
