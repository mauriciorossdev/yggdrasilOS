import { describe, expect, it } from "vitest";
import type { PluginRecord } from "../types.js";
import { catalogWidgets, isRefreshDue, missingToSave, moveInstance, newInstance, queriesPerDay } from "./dashboardLogic.js";

const plugin = {
  key: "global:news",
  scope: "global",
  dir: "",
  url: "x",
  manifest: {
    id: "news",
    name: "News",
    version: "1",
    views: ["widget"],
    permissions: ["net:api.example.com"],
    widget: {
      defaultSize: "m",
      refresh: { defaultSeconds: 3600, minSeconds: 900 },
      fields: [
        { key: "topic", type: "list", title: "Topic", options: [{ value: "tech", label: "Tech" }] },
        { key: "apiKey", type: "secret", title: "API key", required: true, domain: "api.example.com", header: "X" },
      ],
    },
  },
} as PluginRecord;

describe("dashboard logic", () => {
  it("lists only global, published, working widgets", () => {
    const draft = { ...plugin, manifest: { ...plugin.manifest, status: "draft" as const } };
    expect(catalogWidgets([plugin, draft, { ...plugin, scope: "project" }, { ...plugin, error: "x" }])).toEqual([plugin]);
  });

  it("needs the permission and the key before saving", () => {
    const instance = newInstance(plugin, "i1");
    expect(instance.config).toEqual({ topic: "tech" });
    expect(missingToSave(plugin, instance, {}, {})).toEqual({ domains: ["api.example.com"], fields: ["API key"] });
    const granted = { ...instance, grantedDomains: ["api.example.com"] };
    expect(missingToSave(plugin, granted, { apiKey: "k" }, {})).toEqual({ domains: [], fields: [] });
    expect(missingToSave(plugin, granted, {}, { apiKey: "api.example.com" }).fields).toEqual([]);
    // A key saved for another host doesn't count.
    expect(missingToSave(plugin, granted, {}, { apiKey: "old.example.com" }).fields).toEqual(["API key"]);
  });

  it("asks for a refresh only after the interval, never in manual mode", () => {
    expect(isRefreshDue(900, 1000, 1000 + 899_000)).toBe(false);
    expect(isRefreshDue(900, 1000, 1000 + 900_000)).toBe(true);
    expect(isRefreshDue(0, 1000, 9e12)).toBe(false);
    expect(isRefreshDue(900, 0, 9e12)).toBe(false);
    expect(queriesPerDay(3600)).toBe(24);
  });

  it("moves an instance, clamped to the ends", () => {
    const list = ["a", "b", "c"].map((id) => newInstance(plugin, id));
    const ids = (l: typeof list) => l.map((i) => i.instanceId);
    expect(ids(moveInstance(list, "a", 2))).toEqual(["b", "c", "a"]);
    expect(ids(moveInstance(list, "c", -5))).toEqual(["c", "a", "b"]);
    expect(moveInstance(list, "zz", 0)).toBe(list);
  });
});
