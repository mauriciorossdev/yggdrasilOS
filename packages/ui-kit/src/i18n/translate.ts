export type Language = "en" | "es";

export const LANGUAGES: Array<{ id: Language; label: string }> = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
];

const SUPPORTED = new Set<string>(LANGUAGES.map((l) => l.id));

/** The saved choice if it's a supported language, otherwise the OS locale's language, otherwise English. */
export function resolveLanguage(saved: string | null | undefined, systemLocale: string | null | undefined): Language {
  if (saved && SUPPORTED.has(saved)) return saved as Language;
  const base = (systemLocale ?? "").toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.has(base) ? (base as Language) : "en";
}

export type Dictionary = Record<string, string>;

/**
 * Looks `key` up in `dict`, then in `fallback` (English), then falls back to the
 * key itself so a missing string is visible instead of blank. `{name}`
 * placeholders are replaced from `vars`; unknown placeholders are left as-is.
 */
export function translate(dict: Dictionary, fallback: Dictionary, key: string, vars?: Record<string, string | number>): string {
  const template = dict[key] ?? fallback[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
