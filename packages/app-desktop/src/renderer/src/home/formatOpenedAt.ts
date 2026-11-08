import { t } from "../i18n/index.js";

/** "just now", "5 min ago", "3 h ago", "2 days ago" (in the UI language), or the date for anything older than a month. */
export function formatOpenedAt(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("time.now");
  if (minutes < 60) return t("time.min", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hour", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t(days === 1 ? "time.dayOne" : "time.dayMany", { n: days });
  return new Date(timestamp).toLocaleDateString();
}
