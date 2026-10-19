import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopRegistry, MAX_DESKTOPS, ONLINE_WINDOW_MS, STALE_AFTER_MS } from "./desktops.js";

let dir: string;
let file: string;
let clock: number;
const now = () => clock;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "desktops-"));
  file = join(dir, "desktops.json");
  clock = Date.parse("2026-10-08T12:00:00Z");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sample = {
  desktopId: "desk-macbook-1",
  name: "MacBook de Alex",
  projects: [{ id: "p1", name: "harness_pp", port: 51234 }],
  endpoints: { lan: "192.168.1.20", tailscale: "100.64.0.7" },
  gatewayKey: "ygd_secret",
};

describe("DesktopRegistry", () => {
  it("registers, lists as online and survives a reload", async () => {
    const reg = new DesktopRegistry(file, now);
    await reg.load();
    const view = await reg.register(sample);
    expect(view).toMatchObject({ desktopId: "desk-macbook-1", online: true, gatewayKey: "ygd_secret" });
    expect(view.projects).toEqual([{ id: "p1", name: "harness_pp", port: 51234 }]);

    const again = new DesktopRegistry(file, now);
    await again.load();
    expect(again.list().map((d) => d.name)).toEqual(["MacBook de Alex"]);
  });

  it("a heartbeat refreshes lastSeen and replaces the project list but keeps registeredAt", async () => {
    const reg = new DesktopRegistry(file, now);
    await reg.load();
    const first = await reg.register(sample);
    clock += 60_000;
    const second = await reg.register({ ...sample, projects: [{ id: "p2", name: "otro", port: 60000 }] });
    expect(second.registeredAt).toBe(first.registeredAt);
    expect(second.lastSeen).toBe(clock);
    expect(second.projects.map((p) => p.id)).toEqual(["p2"]);
  });

  it("shows a desktop offline once its heartbeat is older than the window", async () => {
    const reg = new DesktopRegistry(file, now);
    await reg.load();
    await reg.register(sample);
    clock += ONLINE_WINDOW_MS + 1;
    expect(reg.list()[0]!.online).toBe(false);
  });

  it("goOffline flips it offline immediately and clears its projects", async () => {
    const reg = new DesktopRegistry(file, now);
    await reg.load();
    await reg.register(sample);
    expect(await reg.goOffline("desk-macbook-1")).toBe(true);
    expect(reg.list()[0]).toMatchObject({ online: false, projects: [] });
    expect(await reg.goOffline("nope-nope")).toBe(false);
  });

  it("orders online desktops first, then by most recent", async () => {
    const reg = new DesktopRegistry(file, now);
    await reg.load();
    await reg.register({ ...sample, desktopId: "desk-old-one", name: "Viejo" });
    clock += ONLINE_WINDOW_MS + 10;
    await reg.register({ ...sample, desktopId: "desk-new-one", name: "Nuevo" });
    expect(reg.list().map((d) => [d.name, d.online])).toEqual([["Nuevo", true], ["Viejo", false]]);
  });

  it("drops records not seen for a month when loading", async () => {
    const reg = new DesktopRegistry(file, now);
    await reg.load();
    await reg.register(sample);
    clock += STALE_AFTER_MS + 1;
    const later = new DesktopRegistry(file, now);
    await later.load();
    expect(later.list()).toEqual([]);
  });

  it("validates ids, hosts, ports and limits", async () => {
    const reg = new DesktopRegistry(file, now);
    await reg.load();
    await expect(reg.register({ ...sample, desktopId: "x" })).rejects.toThrow(/desktopId/);
    await expect(reg.register({ ...sample, name: "  " })).rejects.toThrow(/name required/);
    await expect(reg.register({ ...sample, endpoints: { lan: "http://192.168.1.20" } })).rejects.toThrow(/bare host/);
    await expect(reg.register({ ...sample, endpoints: { lan: "192.168.1.20/x" } })).rejects.toThrow(/bare host/);
    await expect(reg.register({ ...sample, projects: [{ id: "p", name: "n", port: 70000 }] })).rejects.toThrow(/port/);
    await expect(reg.register({ ...sample, gatewayKey: "k".repeat(300) })).rejects.toThrow(/too long/);
    for (let i = 0; i < MAX_DESKTOPS; i++) await reg.register({ ...sample, desktopId: `desk-${String(i).padStart(4, "0")}` });
    await expect(reg.register({ ...sample, desktopId: "desk-one-more" })).rejects.toThrow(/too many desktops/);
  });

  it("remove forgets a desktop", async () => {
    const reg = new DesktopRegistry(file, now);
    await reg.load();
    await reg.register(sample);
    expect(await reg.remove("desk-macbook-1")).toBe(true);
    expect(await reg.remove("desk-macbook-1")).toBe(false);
    expect(reg.list()).toEqual([]);
  });
});
