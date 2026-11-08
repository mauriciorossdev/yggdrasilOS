import type { MessageKey } from "../i18n/index.js";

export type ViewportPreset = { id: string; label: string; labelKey?: MessageKey; width: number; height: number; mobile: boolean };

/** "Responsive" (null preset) = the page fills the whole area, as before. */
export const VIEWPORT_PRESETS: ViewportPreset[] = [
  { id: "mobile-s", label: "Mobile S", labelKey: "browser.viewport.mobileS", width: 320, height: 568, mobile: true },
  { id: "iphone", label: "iPhone 14", width: 390, height: 844, mobile: true },
  { id: "mobile-l", label: "Mobile L", labelKey: "browser.viewport.mobileL", width: 430, height: 932, mobile: true },
  { id: "tablet", label: "Tablet", labelKey: "browser.viewport.tablet", width: 768, height: 1024, mobile: true },
  { id: "laptop", label: "Laptop", labelKey: "browser.viewport.laptop", width: 1280, height: 800, mobile: false },
  { id: "desktop", label: "Desktop", labelKey: "browser.viewport.desktop", width: 1440, height: 900, mobile: false },
  { id: "fullhd", label: "Full HD", width: 1920, height: 1080, mobile: false },
];

export function findViewportPreset(id: string | null | undefined): ViewportPreset | null {
  return VIEWPORT_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Largest scale (≤ 1) at which the preset fits inside the area, and the resulting on-screen size. */
/** Width of `area` left visible when `coveredFromRight` pixels of the window's right edge are covered. Never 0: a view can't be sized to nothing. */
export function uncoveredWidth(area: { x: number; width: number }, windowWidth: number, coveredFromRight: number): number {
  if (coveredFromRight <= 0) return area.width;
  return Math.max(1, Math.min(area.x + area.width, windowWidth - coveredFromRight) - area.x);
}

export function fitViewport(
  preset: ViewportPreset,
  area: { width: number; height: number },
): { scale: number; width: number; height: number } {
  const scale = Math.min(1, area.width / preset.width, area.height / preset.height);
  const safe = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { scale: safe, width: Math.max(1, Math.floor(preset.width * safe)), height: Math.max(1, Math.floor(preset.height * safe)) };
}
