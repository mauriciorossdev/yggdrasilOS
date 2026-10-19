import { useCallback, useEffect, useState } from "react";
import type { ProjectRecord } from "../types.js";

export function useProjects() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProjects(await window.yggdrasil.projects.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live-patch color changes made from any window (e.g. another project's own
  // TitleBar) — this sidebar list shouldn't need a manual refresh to reflect it.
  useEffect(
    () =>
      window.yggdrasil.projects.onColorChange((id, color) => {
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, color } : p)));
      }),
    [],
  );

  const openExisting = useCallback(async () => {
    try {
      await window.yggdrasil.projects.openExisting();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refresh]);

  const createNew = useCallback(async () => {
    try {
      await window.yggdrasil.projects.createNew();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refresh]);

  const open = useCallback(
    async (id: string) => {
      try {
        await window.yggdrasil.projects.open(id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      try {
        await window.yggdrasil.projects.rename(id, name);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  return { projects, error, refresh, openExisting, createNew, open, rename };
}
