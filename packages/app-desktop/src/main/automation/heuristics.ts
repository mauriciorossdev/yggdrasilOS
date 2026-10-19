/**
 * Pure logic with no Electron dependency, kept in its own module so it's
 * testable under plain vitest — darwin.ts (which imports `electron`) can't
 * be unit-tested in this repo's setup (no existing main-process test touches
 * Electron APIs directly; see claudeTranscript.test.ts for the pattern this
 * follows instead).
 */

/**
 * Cheap best-effort check, not a hard gate — the real defense against the
 * silent-wallpaper bug (notes/automation/workflows-design.md §1) is the
 * permission check darwin.ts does *before* ever capturing. This just flags a
 * capture that looks like a single flat colour across a spread grid of
 * sample points, the shape a blocked capture actually takes.
 *
 * `bitmap` is a BGRA (or RGBA — channel order doesn't matter for a flatness
 * check) buffer, `width`/`height` its pixel dimensions, row-major.
 */
export function isBitmapLikelyBlank(bitmap: Uint8Array, width: number, height: number): boolean {
  if (width < 4 || height < 4) return true;

  const grid = 4;
  const tolerance = 6;
  let first: [number, number, number] | undefined;

  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const x = Math.floor((width - 1) * (col / (grid - 1)));
      const y = Math.floor((height - 1) * (row / (grid - 1)));
      const offset = (y * width + x) * 4;
      const pixel: [number, number, number] = [bitmap[offset] ?? 0, bitmap[offset + 1] ?? 0, bitmap[offset + 2] ?? 0];
      if (!first) {
        first = pixel;
        continue;
      }
      if (pixel.some((v, i) => Math.abs(v - first![i]) > tolerance)) return false;
    }
  }
  return true;
}

/** Loose match used to decide whether the frontmost app is the one `desktop_open_app` just asked for — app names shown by lsappinfo/NSRunningApplication don't always match /Applications' bundle name exactly (localization, "Microsoft Teams" vs "Teams"). */
export function frontmostMatchesRequestedApp(frontmost: string | null, requestedName: string): boolean {
  if (!frontmost) return false;
  const a = frontmost.toLowerCase().trim();
  const b = requestedName.toLowerCase().trim();
  return a.includes(b) || b.includes(a);
}

/**
 * Picks which desktopCapturer source to capture for `desktop_screenshot`.
 *
 * A "window" capture doesn't need its target frontmost — macOS can capture
 * an occluded/background window's real content just fine once Screen
 * Recording is granted — so it's independent of whatever grabbed focus while
 * the approval dialog was up. What actually broke this (a real bug found
 * live: asking for Figma's window captured the Yggdrasil chat window
 * instead) was silently falling back to `sources[0]` — effectively whatever
 * window happens to be listed first, usually the current frontmost one —
 * whenever the requested app's name didn't match any open window. That's a
 * silent-wrong-capture, the same class of bug as the unchecked-permission
 * wallpaper case (workflows-design.md §1): it never fails loudly, it just
 * shows the wrong thing as if it were right. `mode: "screen"` has no target
 * to match against, so sources[0] (the display) is the correct pick there.
 */
export function pickCaptureSource<T extends { name: string }>(
  sources: T[],
  mode: "screen" | "window",
  app?: string,
): { source?: T; error?: string } {
  if (mode === "screen" || !app) return { source: sources[0] };

  const needle = app.toLowerCase();
  const match = sources.find((s) => s.name.toLowerCase().includes(needle));
  if (match) return { source: match };

  const openWindows = sources.map((s) => s.name).join(", ") || "(none)";
  return { error: `window_not_found: no open window matches "${app}". Open windows: ${openWindows}` };
}
