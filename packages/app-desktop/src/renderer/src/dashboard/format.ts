import { t } from "../i18n/index.js";

export function refreshLabel(seconds: number): string {
  if (seconds === 0) return t("dashboard.refresh.manual");
  if (seconds < 3600) return t("dashboard.refresh.minutes", { count: Math.round(seconds / 60) });
  if (seconds < 86400) return t("dashboard.refresh.hours", { count: Math.round(seconds / 3600) });
  return t("dashboard.refresh.day");
}

export function agoLabel(fetchedAt: number, now: number): string {
  const minutes = Math.floor((now - fetchedAt) / 60000);
  if (minutes < 1) return t("dashboard.ago.now");
  if (minutes < 60) return t("dashboard.ago.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("dashboard.ago.hours", { count: hours });
  return t("dashboard.ago.days", { count: Math.floor(hours / 24) });
}
