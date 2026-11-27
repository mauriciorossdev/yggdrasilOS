// Pure rules of the Dashboard tab (notes/features/dashboard.md).
import type { PluginRecord, WidgetInstance, WidgetSpec } from "../types.js";

export const REFRESH_OPTIONS = [900, 1800, 3600, 21600, 86400, 0];

/** The widgets the catalog offers: global, published, not broken. */
export function catalogWidgets(plugins: PluginRecord[]): PluginRecord[] {
  return plugins.filter(
    (p) => p.scope === "global" && !p.error && p.manifest.status !== "draft" && p.manifest.views.includes("widget") && !!p.manifest.widget,
  );
}

export function netDomainsOf(plugin: PluginRecord): string[] {
  return (plugin.manifest.permissions ?? []).filter((p) => p.startsWith("net:")).map((p) => p.slice(4));
}

export function refreshChoices(spec: WidgetSpec): number[] {
  return REFRESH_OPTIONS.filter((s) => s === 0 || s >= spec.refresh.minSeconds);
}

/** Most queries one instance can make in a day on its own; 0 = manual only. */
export function queriesPerDay(seconds: number): number {
  return seconds > 0 ? Math.ceil(86400 / seconds) : 0;
}

export function defaultConfig(spec: WidgetSpec): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const f of spec.fields) {
    if (f.type === "secret") continue;
    config[f.key] = f.default ?? (f.type === "list" ? f.options?.[0]?.value : f.type === "bool" ? false : "") ?? "";
  }
  return config;
}

export function newInstance(plugin: PluginRecord, instanceId: string): WidgetInstance {
  const spec = plugin.manifest.widget!;
  return {
    instanceId,
    pluginKey: plugin.key,
    title: plugin.manifest.name,
    size: spec.defaultSize,
    config: defaultConfig(spec),
    refreshSeconds: spec.refresh.defaultSeconds,
    grantedDomains: [],
  };
}

/** What still keeps an instance from being saved. `saved` is field -> host of stored secrets. */
export function missingToSave(
  plugin: PluginRecord,
  instance: WidgetInstance,
  typed: Record<string, string>,
  saved: Record<string, string>,
): { domains: string[]; fields: string[] } {
  const spec = plugin.manifest.widget!;
  const domains = netDomainsOf(plugin).filter((d) => !instance.grantedDomains.includes(d));
  const fields = spec.fields
    .filter((f) => {
      if (!f.required) return false;
      if (f.type === "secret") return !typed[f.key] && saved[f.key] !== f.domain;
      const value = instance.config[f.key];
      return value === undefined || value === "";
    })
    .map((f) => f.title);
  return { domains, fields };
}

/** Whether the host should ask a widget to refresh now. Times are ms; 0 = never. */
export function isRefreshDue(refreshSeconds: number, lastAttempt: number, now: number): boolean {
  return refreshSeconds > 0 && lastAttempt > 0 && now - lastAttempt >= refreshSeconds * 1000;
}

/** `order` with `id` moved to `to` (clamped). */
export function moveInstance(instances: WidgetInstance[], id: string, to: number): WidgetInstance[] {
  const from = instances.findIndex((i) => i.instanceId === id);
  if (from < 0) return instances;
  const next = [...instances];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}
