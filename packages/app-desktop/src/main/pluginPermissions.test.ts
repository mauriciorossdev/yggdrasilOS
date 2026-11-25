import { describe, expect, it } from "vitest";
import { permissionsUsedIn } from "./pluginPermissions.js";

describe("permissionsUsedIn", () => {
  it("maps fs reads and the fs.changed event to fs", () => {
    expect(permissionsUsedIn('const { content } = await ygg.fs.read("a.md");')).toEqual(["fs"]);
    expect(permissionsUsedIn("const l = await ygg.fs.list ('x');")).toEqual(["fs"]);
    expect(permissionsUsedIn('ygg.on("fs.changed", refresh);')).toEqual(["fs"]);
  });

  it("maps fs writes and mkdir to fs:write", () => {
    expect(permissionsUsedIn('await ygg.fs.write("a.md", text);')).toEqual(["fs:write"]);
    expect(permissionsUsedIn('await ygg.fs.mkdir("dir");')).toEqual(["fs:write"]);
  });

  it("maps any ygg.panes call to panes", () => {
    expect(permissionsUsedIn("const panes = await ygg.panes.list();")).toEqual(["panes"]);
  });

  it("names the gateway method each call needs", () => {
    expect(permissionsUsedIn('await ygg.gateway.call("chat.send", {}); ygg.gateway.call(`agents.list`)')).toEqual([
      "gateway:chat.send",
      "gateway:agents.list",
    ]);
  });

  it("ignores storage, app and unrelated text", () => {
    expect(permissionsUsedIn('await ygg.storage.set("k", 1); ygg.app.notify("x"); // fs write later')).toEqual([]);
  });
});
