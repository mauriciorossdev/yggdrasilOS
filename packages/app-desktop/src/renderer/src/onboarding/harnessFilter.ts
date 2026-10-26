import type { CliId, OnboardingSettings } from "../types.js";

type FilterSettings = Pick<OnboardingSettings, "enabledHarnesses" | "showAllClis">;

/**
 * Whether an agent CLI should appear in menus/pickers. Nothing is hidden until
 * the user has actually chosen (enabledHarnesses === null) or if they turned
 * the filter off in Settings (showAllClis).
 */
export function isCliVisible(id: CliId, settings: FilterSettings | null): boolean {
  if (!settings || settings.showAllClis || settings.enabledHarnesses === null) return true;
  return settings.enabledHarnesses.includes(id);
}

/** Keeps items whose CLI is visible; items that aren't a CLI at all (idOf → null, e.g. the system shell or yggdrasil) always stay. */
export function filterVisibleClis<T>(items: T[], idOf: (item: T) => CliId | null, settings: FilterSettings | null): T[] {
  return items.filter((item) => {
    const id = idOf(item);
    return id === null || isCliVisible(id, settings);
  });
}

/** The Studio picker names Antigravity "agy"; everything else uses the harness type as id. */
export function cliIdFromHarnessName(name: string): CliId | null {
  if (name === "agy" || name === "antigravity") return "antigravity";
  if (name === "claude" || name === "omp" || name === "copilot") return name;
  return null;
}

export type LaunchCli = { id: CliId; label: string; command: string };

const LAUNCHABLE_CLIS: LaunchCli[] = [
  { id: "claude", label: "Claude Code", command: "claude" },
  { id: "copilot", label: "GitHub Copilot CLI", command: "copilot" },
  { id: "antigravity", label: "Antigravity", command: "agy" },
  { id: "omp", label: "omp", command: "omp" },
];

/**
 * CLIs offered by the "New terminal" screen. Until the user has chosen, that
 * screen keeps its original single Claude Code button; once they have, it lists
 * the ones they picked (or all four with showAllClis).
 */
export function terminalLaunchClis(settings: FilterSettings | null): LaunchCli[] {
  if (!settings || (settings.enabledHarnesses === null && !settings.showAllClis)) return [LAUNCHABLE_CLIS[0]];
  return LAUNCHABLE_CLIS.filter((cli) => isCliVisible(cli.id, settings));
}
