import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AssetError, decodeDataUrl, extensionFor, isAllowedContentType, readLimited, resolveAssetDest, saveFetchedAsset,
} from "./browserAssets.js";

let root: string;
let outside: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ygg-assets-"));
  outside = await mkdtemp(join(tmpdir(), "ygg-outside-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const png = { data: new Uint8Array([1, 2, 3]), contentType: "image/png", url: "https://e.com/a.png" };

describe("resolveAssetDest", () => {
  it("accepts a nested relative path", async () => {
    expect((await resolveAssetDest(root, "notes/assets/a.png")).endsWith(join("notes", "assets", "a.png"))).toBe(true);
  });
  it.each(["", "/etc/x.png", "../x.png", "a/../../x.png", ".git/x.png", "node_modules/a/x.png", "a/\0b.png"])("rejects %j", async (p) => {
    await expect(resolveAssetDest(root, p)).rejects.toBeInstanceOf(AssetError);
  });
  it("rejects dangerous extensions", async () => {
    await expect(resolveAssetDest(root, "notes/run.sh")).rejects.toThrow(/not allowed/);
    await expect(resolveAssetDest(root, "notes/app.js")).rejects.toThrow(/not allowed/);
  });
  it("needs an extension unless one is implied by the content type", async () => {
    await expect(resolveAssetDest(root, "notes/pic")).rejects.toThrow(/extension/);
    expect((await resolveAssetDest(root, "notes/pic", ".png")).endsWith("pic.png")).toBe(true);
  });
  it("rejects a symlinked directory that escapes the project", async () => {
    await symlink(outside, join(root, "link"));
    await expect(resolveAssetDest(root, "link/x.png")).rejects.toThrow(/inside the project/);
    await expect(resolveAssetDest(root, "link/deeper/x.png")).rejects.toThrow(/inside the project/);
  });
});

describe("saveFetchedAsset", () => {
  it("writes the file and reports the project-relative path", async () => {
    const r = await saveFetchedAsset(root, "notes/assets/a.png", png);
    expect(r).toMatchObject({ path: join("notes", "assets", "a.png"), bytes: 3, contentType: "image/png" });
    expect([...(await readFile(join(root, r.path)))]).toEqual([1, 2, 3]);
  });
  it("adds the extension from the content type", async () => {
    expect((await saveFetchedAsset(root, "notes/pic", png)).path).toBe(join("notes", "pic.png"));
  });
  it("never overwrites", async () => {
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes", "a.png"), "keep");
    await expect(saveFetchedAsset(root, "notes/a.png", png)).rejects.toThrow(/already exists/);
    expect(await readFile(join(root, "notes", "a.png"), "utf8")).toBe("keep");
  });
  it("rejects disallowed content types", async () => {
    await expect(saveFetchedAsset(root, "notes/a.png", { ...png, contentType: "text/html" })).rejects.toThrow(/content type/);
    await expect(saveFetchedAsset(root, "notes/a.png", { ...png, contentType: "application/x-msdownload" })).rejects.toThrow(/content type/);
  });
});

describe("helpers", () => {
  it("content types", () => {
    expect(isAllowedContentType("image/svg+xml; charset=utf-8")).toBe(true);
    expect(isAllowedContentType("application/pdf")).toBe(true);
    expect(isAllowedContentType("text/html")).toBe(false);
    expect(extensionFor("image/jpeg")).toBe(".jpg");
    expect(extensionFor("text/html")).toBeUndefined();
  });
  it("readLimited stops at the cap", async () => {
    const res = new Response(new Uint8Array(100));
    await expect(readLimited(res, 50)).rejects.toThrow(/larger/);
    expect((await readLimited(new Response(new Uint8Array(10)), 50)).byteLength).toBe(10);
  });
  it("decodes data URLs", () => {
    const a = decodeDataUrl("data:image/png;base64,AQID", 100);
    expect([...a.data]).toEqual([1, 2, 3]);
    expect(a.contentType).toBe("image/png");
    expect(() => decodeDataUrl("data:image/png;base64,AQID", 2)).toThrow(/larger/);
    expect(() => decodeDataUrl("nonsense", 10)).toThrow(/malformed/);
  });
});
