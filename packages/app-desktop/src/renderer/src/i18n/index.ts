import { useSyncExternalStore } from "react";
import {
  getLanguage,
  kitEn,
  kitEs,
  subscribeLanguage,
  translate,
  type Dictionary,
  type KitKey,
  type Language,
} from "@yggdrasil/ui-kit";
import { en, type MessageKey as AppMessageKey } from "./en.js";
import { es } from "./es.js";

export { LANGUAGES, getLanguage, resolveLanguage, setLanguage, type Language } from "@yggdrasil/ui-kit";

/** The app's own strings plus the ui-kit's (its components and theme). */
export type MessageKey = AppMessageKey | KitKey;

// The language store lives in @yggdrasil/ui-kit, so kit components re-render when it changes.
const dictionaries: Record<Language, Dictionary> = { en: { ...kitEn, ...en }, es: { ...kitEs, ...es } };

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(dictionaries[getLanguage()], dictionaries.en, key, vars);
}

/** Re-renders the caller when the language changes; returns the bound `t`. */
export function useI18n(): { t: typeof t; language: Language } {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage);
  return { t, language };
}
