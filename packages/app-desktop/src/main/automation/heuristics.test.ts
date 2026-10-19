import { describe, it, expect } from "vitest";
import { isBitmapLikelyBlank, frontmostMatchesRequestedApp, pickCaptureSource } from "./heuristics.js";

function solidBitmap(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const buf = new Uint8Array(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  }
  return buf;
}

describe("isBitmapLikelyBlank", () => {
  it("flags a single flat colour (the shape a blocked capture actually takes)", () => {
    expect(isBitmapLikelyBlank(solidBitmap(100, 100, 30, 30, 30), 100, 100)).toBe(true);
  });

  it("does not flag an image with real variation across the grid", () => {
    const buf = solidBitmap(100, 100, 0, 0, 0);
    // Push one corner sample point far from the rest.
    const offset = (99 * 100 + 99) * 4;
    buf[offset] = 255;
    buf[offset + 1] = 255;
    buf[offset + 2] = 255;
    expect(isBitmapLikelyBlank(buf, 100, 100)).toBe(false);
  });

  it("flags a degenerate (too small) image as blank rather than risking a false negative", () => {
    expect(isBitmapLikelyBlank(new Uint8Array(0), 0, 0)).toBe(true);
  });
});

describe("frontmostMatchesRequestedApp", () => {
  it("matches an exact name", () => {
    expect(frontmostMatchesRequestedApp("Microsoft Teams", "Microsoft Teams")).toBe(true);
  });

  it("matches a partial/localized name in either direction", () => {
    expect(frontmostMatchesRequestedApp("Teams", "Microsoft Teams")).toBe(true);
    expect(frontmostMatchesRequestedApp("Microsoft Teams", "Teams")).toBe(true);
  });

  it("does not match an unrelated app", () => {
    expect(frontmostMatchesRequestedApp("Finder", "Microsoft Teams")).toBe(false);
  });

  it("does not match when nothing is frontmost", () => {
    expect(frontmostMatchesRequestedApp(null, "Microsoft Teams")).toBe(false);
  });
});

describe("pickCaptureSource", () => {
  const sources = [{ name: "Yggdrasil" }, { name: "Figma" }, { name: "Terminal" }];

  it("picks the display source for mode=screen regardless of app", () => {
    expect(pickCaptureSource(sources, "screen", "Figma")).toEqual({ source: sources[0] });
  });

  it("matches the named window case-insensitively for mode=window", () => {
    expect(pickCaptureSource(sources, "window", "figma")).toEqual({ source: sources[1] });
  });

  it("falls back to the first source when mode=window has no app name", () => {
    expect(pickCaptureSource(sources, "window")).toEqual({ source: sources[0] });
  });

  it("fails loudly instead of silently capturing the wrong window when nothing matches", () => {
    // This is the actual bug found live: asking for a Figma window capture,
    // with the approval dialog stealing focus back to Yggdrasil in between,
    // used to silently fall back to sources[0] and capture the chat window
    // instead of failing — see the comment on pickCaptureSource.
    const result = pickCaptureSource(sources, "window", "Slack");
    expect(result.source).toBeUndefined();
    expect(result.error).toContain("Slack");
    expect(result.error).toContain("Yggdrasil, Figma, Terminal");
  });
});
