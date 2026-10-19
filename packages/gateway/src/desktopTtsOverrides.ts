import { readFile } from "node:fs/promises";

export type DesktopTtsOverrides = {
  enabled: boolean;
  voiceId?: string;
  apiToken?: string;
};

/**
 * Reads the desktop app's own desktop-settings.json directly (plain fs, no
 * Electron API) — YGGDRASIL_DESKTOP_SETTINGS_PATH is set by
 * packages/app-desktop/src/main/gateway.ts when this gateway was spawned by
 * the desktop app; unset when run standalone (`yggdrasil run`, CI, the
 * Railway hub deploy), where TTS is configured purely via env vars instead
 * (REPLICATE_API_TOKEN/REPLICATE_TTS_VOICE, see tts.ts) and there's no
 * Settings → Voz UI at all. Same pattern as
 * extensions/service-workflows/src/killSwitch.ts's automation kill switch.
 */
export async function loadDesktopTtsOverrides(): Promise<DesktopTtsOverrides> {
  const path = process.env.YGGDRASIL_DESKTOP_SETTINGS_PATH;
  if (!path) return { enabled: true };
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as {
      tts?: { enabled?: boolean; voiceId?: string; apiToken?: string };
    };
    return {
      enabled: raw.tts?.enabled !== false,
      voiceId: raw.tts?.voiceId || undefined,
      apiToken: raw.tts?.apiToken || undefined,
    };
  } catch {
    return { enabled: true }; // missing/corrupt file — fail open, not disabled
  }
}
