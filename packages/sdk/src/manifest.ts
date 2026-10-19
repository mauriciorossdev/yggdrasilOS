export type YggdrasilPluginManifest = {
  id: string;
  kind?: Array<"channel" | "harness" | "provider" | "service" | "tool" | "context" | "skill">;
  entry: string;
  name?: string;
  version?: string;
  channels?: Array<{ id: string; label: string }>;
  compat?: { pluginApi?: string };
};

export const PLUGIN_MANIFEST_FILENAME = "yggdrasil.plugin.json";
export const CURRENT_PLUGIN_API_VERSION = "0.3.0";

export function isPluginApiCompatible(required?: string): boolean {
  if (!required) return true;
  const current = CURRENT_PLUGIN_API_VERSION.split(".").map(Number);
  if (required.startsWith(">=")) {
    const min = required.slice(2).trim().split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const c = current[i] ?? 0;
      const m = min[i] ?? 0;
      if (c > m) return true;
      if (c < m) return false;
    }
    return true;
  }
  return required === CURRENT_PLUGIN_API_VERSION;
}

export function parsePluginManifest(raw: unknown): YggdrasilPluginManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid plugin manifest: expected object");
  }
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const entry = typeof obj.entry === "string" ? obj.entry.trim() : "";
  if (!id || !entry) {
    throw new Error("Invalid plugin manifest: id and entry are required");
  }
  return {
    id,
    entry,
    name: typeof obj.name === "string" ? obj.name : undefined,
    version: typeof obj.version === "string" ? obj.version : undefined,
    kind: Array.isArray(obj.kind)
      ? (obj.kind.filter((k) => typeof k === "string") as YggdrasilPluginManifest["kind"])
      : undefined,
    channels: Array.isArray(obj.channels)
      ? obj.channels
          .filter((c) => c && typeof c === "object")
          .map((c) => {
            const ch = c as Record<string, unknown>;
            return {
              id: String(ch.id ?? ""),
              label: String(ch.label ?? ch.id ?? ""),
            };
          })
          .filter((c) => c.id)
      : undefined,
    compat:
      obj.compat && typeof obj.compat === "object"
        ? { pluginApi: (obj.compat as Record<string, unknown>).pluginApi as string | undefined }
        : undefined,
  };
}
