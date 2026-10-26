import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";
import { CLI_CATALOG, type CliId } from "./cliDetect.js";

/** Bump when the wizard gains steps worth showing again to people who already finished it. */
export const ONBOARDING_VERSION = 1;

export type UsageMode = "cli" | "api" | "local";

export type OnboardingSettings = {
  /** ISO timestamp of finishing (or skipping) the wizard; null = never. */
  completedAt: string | null;
  /** ONBOARDING_VERSION at completion time. */
  version: number;
  /** UI language chosen in the wizard; null = follow the OS locale. */
  language: string | null;
  /** CLIs the user said they use; null = never chose, so nothing is filtered. */
  enabledHarnesses: CliId[] | null;
  usage: UsageMode[];
  /** Escape hatch from the filter (Settings → "Show all CLIs"). */
  showAllClis: boolean;
};

export function defaultOnboardingSettings(): OnboardingSettings {
  return { completedAt: null, version: 0, language: null, enabledHarnesses: null, usage: [], showAllClis: false };
}

const CLI_IDS = new Set<string>(CLI_CATALOG.map((c) => c.id));
const USAGE_MODES = new Set<string>(["cli", "api", "local"]);

/** Coerces whatever is on disk (or sent over IPC) into a valid OnboardingSettings, dropping unknown values. */
export function sanitizeOnboarding(raw: unknown): OnboardingSettings {
  const base = defaultOnboardingSettings();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  return {
    completedAt: typeof r.completedAt === "string" ? r.completedAt : null,
    version: typeof r.version === "number" && Number.isFinite(r.version) ? r.version : 0,
    language: typeof r.language === "string" && r.language ? r.language : null,
    enabledHarnesses: Array.isArray(r.enabledHarnesses)
      ? (r.enabledHarnesses.filter((id): id is CliId => typeof id === "string" && CLI_IDS.has(id)) as CliId[])
      : null,
    usage: Array.isArray(r.usage)
      ? (r.usage.filter((u): u is UsageMode => typeof u === "string" && USAGE_MODES.has(u)) as UsageMode[])
      : [],
    showAllClis: r.showAllClis === true,
  };
}

/**
 * The wizard opens by itself only on a fresh install. Someone who already
 * configured an IDE has been using the app, so don't interrupt them — the
 * wizard stays reachable from Settings.
 */
export function shouldAutoOpenOnboarding(settings: OnboardingSettings, hasExistingConfig: boolean): boolean {
  if (settings.completedAt) return false;
  return !hasExistingConfig;
}

export async function loadOnboardingSettings(userDataDir: string): Promise<OnboardingSettings> {
  const raw = await readSettingsFile(userDataDir);
  return sanitizeOnboarding((raw as { onboarding?: unknown }).onboarding);
}

export async function saveOnboardingSettings(userDataDir: string, settings: OnboardingSettings): Promise<OnboardingSettings> {
  const clean = sanitizeOnboarding(settings);
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, onboarding: clean }));
  return clean;
}

export async function hasExistingConfig(userDataDir: string): Promise<boolean> {
  const raw = await readSettingsFile(userDataDir);
  const ide = (raw as { ide?: { configuredId?: unknown } }).ide;
  return typeof ide?.configuredId === "string" && ide.configuredId.length > 0;
}
