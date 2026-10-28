import { useSyncExternalStore } from "react";
import { en, type MessageKey } from "./en.js";
import { es } from "./es.js";
import { resolveLanguage, translate, type Dictionary, type Language } from "./translate.js";

export { LANGUAGES, resolveLanguage, type Language } from "./translate.js";
export type { MessageKey } from "./en.js";

const dictionaries: Record<Language, Dictionary> = { en, es };

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

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(dictionaries[current], en, key, vars);
}

/** Re-renders the caller when the language changes; returns the bound `t`. */
export function useI18n(): { t: typeof t; language: Language } {
  const language = useSyncExternalStore(subscribe, getLanguage);
  return { t, language };
}
