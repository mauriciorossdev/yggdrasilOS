import type { CliId, OnboardingUsage } from "../types.js";
import type { Language } from "../i18n/index.js";

/** Everything the wizard collects before Finish writes it out. */
export type WizardDraft = {
  language: Language;
  /** What the wizard calls the user; "" = not given. */
  userName: string;
  enabled: CliId[];
  usage: OnboardingUsage[];
  /** IDE_CATALOG id, "custom", or null for none. */
  ideId: string | null;
  /** Label to show in the summary for ideId. */
  ideLabel: string | null;
  ollamaModel: string | null;
  /** Labels of the API providers that connected during the Models step, for the summary. */
  apiProviders: string[];
};

export type WizardUpdate = (patch: Partial<WizardDraft>) => void;

export function toggle<T>(list: T[], item: T, on: boolean): T[] {
  const without = list.filter((x) => x !== item);
  return on ? [...without, item] : without;
}
