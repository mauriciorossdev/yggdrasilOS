import { useSyncExternalStore } from "react";
import { kitEn, type KitKey } from "./kit.en.js";
import { kitEs } from "./kit.es.js";
import { resolveLanguage, translate, type Dictionary, type Language } from "./translate.js";

export { LANGUAGES, resolveLanguage, translate, type Dictionary, type Language } from "./translate.js";
export { kitEn, type KitKey } from "./kit.en.js";
export { kitEs } from "./kit.es.js";

/**
 * The one UI-language store, shared by the kit's components and by each app that uses
 * the kit (app-desktop, web-console): an app's own i18n reads and sets the language
 * here, so changing it re-renders kit components too.
 */
let current: Language = resolveLanguage(null, typeof navigator === "undefined" ? undefined : navigator.language);
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  for (const listener of listeners) listener();
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const kitDictionaries: Record<Language, Dictionary> = { en: kitEn, es: kitEs };

/** Translates one of the kit's own keys in the current language. */
export function t(key: KitKey, vars?: Record<string, string | number>): string {
  return translate(kitDictionaries[current], kitEn, key, vars);
}

/** Re-renders the caller when the language changes; returns the kit's `t`. */
export function useI18n(): { t: typeof t; language: Language } {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage);
  return { t, language };
}
