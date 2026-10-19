import { useCallback, useEffect, useState } from "react";
import type { PluginRecord } from "../types.js";

export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  // A single shared reload counter, not one per plugin key — any change
  // anywhere (a file edited, a plugin added/removed, a manual "Recargar")
  // bumps it and every open PluginFrame reloads its iframe together.
  // Simpler than per-key versioning and just as correct: a plugin's own
  // durable state lives in ygg.storage, never in iframe-local JS state worth
  // preserving across an unrelated plugin's reload.
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPlugins(await window.yggdrasil.plugins.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      window.yggdrasil.plugins.onChanged(() => {
        void refresh();
        setVersion((v) => v + 1);
      }),
    [refresh],
  );

  const reload = useCallback(async () => {
    try {
      setPlugins(await window.yggdrasil.plugins.reload());
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return { plugins, version, error, refresh, reload };
}
