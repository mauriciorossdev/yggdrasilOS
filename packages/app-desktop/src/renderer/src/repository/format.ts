import { t } from "../i18n/index.js";
/** "3 days ago" style label for an ISO date, in the current UI language; falls back to the raw string when unparsable. */
export function relativeTime(iso: string, now: number = Date.now(), tr: typeof t = t): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return tr("time.now");
  const min = Math.floor(sec / 60);
  if (min < 60) return tr("time.min", { n: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return tr("time.hour", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return tr(days === 1 ? "time.dayOne" : "time.dayMany", { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return tr(months === 1 ? "time.monthOne" : "time.monthMany", { n: months });
  const years = Math.floor(days / 365);
  return tr(years === 1 ? "time.yearOne" : "time.yearMany", { n: years });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "?";
  const second = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + second).toUpperCase();
}

/** Splits a path into its directory (with trailing slash) and file name. */
export function splitPath(path: string): { dir: string; file: string } {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? { dir: path.slice(0, slash + 1), file: path.slice(slash + 1) } : { dir: "", file: path };
}
