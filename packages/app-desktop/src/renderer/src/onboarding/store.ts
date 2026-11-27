import { useSyncExternalStore } from "react";
import type { OnboardingSettings } from "../types.js";
import { resolveLanguage, setLanguage } from "../i18n/index.js";

export type OnboardingStore = {
  loaded: boolean;
  settings: OnboardingSettings | null;
  /** True on a fresh install: the wizard should open by itself. */
  autoOpen: boolean;
  /** Whether the wizard is on screen right now (auto-opened, or opened from Settings). */
  open: boolean;
  /** Opened by hand (Settings): leaving it changes nothing. */
  manual: boolean;
};

let state: OnboardingStore = { loaded: false, settings: null, autoOpen: false, open: false, manual: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: OnboardingStore): void {
  state = next;
  for (const listener of listeners) listener();
}

function applyLanguage(settings: OnboardingSettings): void {
  setLanguage(resolveLanguage(settings.language, navigator.language));
}

/** Loads settings from main once (re-callable to refresh). */
export function loadOnboarding(): Promise<void> {
  inflight ??= window.yggdrasil.onboarding
    .getState()
    .then(({ settings, autoOpen }) => {
      applyLanguage(settings);
      emit({ loaded: true, settings, autoOpen, open: autoOpen, manual: false });
    })
    .catch(() => emit({ ...state, loaded: true }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function saveOnboarding(settings: OnboardingSettings): Promise<OnboardingSettings> {
  const saved = await window.yggdrasil.onboarding.save(settings);
  applyLanguage(saved);
  emit({ ...state, loaded: true, settings: saved, autoOpen: false });
  return saved;
}

export function openWizard(): void {
  emit({ ...state, open: true, manual: true });
}

export function closeWizard(): void {
  emit({ ...state, open: false, manual: false });
}

/** Leaves a wizard opened by hand without saving; the language step previews live, so put it back. */
export function cancelWizard(): void {
  if (state.settings) applyLanguage(state.settings);
  closeWizard();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOnboarding(): OnboardingStore {
  return useSyncExternalStore(subscribe, () => state);
}
