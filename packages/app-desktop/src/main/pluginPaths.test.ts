import { describe, expect, it } from "vitest";
import { isDesktopPluginDir, reconcilePluginPaths } from "./pluginPaths.js";

const PACKAGED = "/Applications/yggdrasil-desktop.app/Contents/Resources/app/node_modules/@yggdrasil";
const DEV = "/Users/x/yggdrasil/packages/app-desktop/node_modules/@yggdrasil";

describe("pluginPaths", () => {
  it("recognizes packaged (mac/win) and dev plugin dirs, not user dirs", () => {
    expect(isDesktopPluginDir(PACKAGED)).toBe(true);
    expect(isDesktopPluginDir("C:\\Users\\x\\AppData\\Local\\Programs\\ygg\\resources\\app\\node_modules\\@yggdrasil")).toBe(true);
    expect(isDesktopPluginDir(DEV)).toBe(true);
    expect(isDesktopPluginDir("/home/x/my-plugins")).toBe(false);
    expect(isDesktopPluginDir("/home/x/proj/node_modules/@yggdrasil")).toBe(false);
  });

  it("drops a stale install's dir and keeps user paths", () => {
    expect(reconcilePluginPaths([PACKAGED, "/home/x/my-plugins", DEV], DEV)).toEqual(["/home/x/my-plugins", DEV]);
  });

  it("appends current when missing, is idempotent", () => {
    const once = reconcilePluginPaths([PACKAGED], DEV);
    expect(once).toEqual([DEV]);
    expect(reconcilePluginPaths(once, DEV)).toEqual(once);
  });
});
