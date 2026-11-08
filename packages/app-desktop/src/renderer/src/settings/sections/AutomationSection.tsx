import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n/index.js";
import type { AutomationSettings, DesktopPermissions, PermissionKind, PermissionState } from "../../types.js";

const PERMISSION_LABEL: Record<PermissionKind, MessageKey> = {
  screen: "set.automation.permScreen",
  accessibility: "set.automation.permAccessibility",
};

function statusLabel(state: PermissionState): MessageKey {
  switch (state) {
    case "granted":
      return "set.automation.granted";
    case "denied":
      return "set.automation.denied";
    case "not-determined":
      return "set.automation.notDetermined";
    case "restricted":
      return "set.automation.restricted";
    case "unsupported":
      return "set.automation.unsupported";
  }
}

/**
 * Own load/mutate cycle via window.yggdrasil.automation (Electron IPC, not
 * the gateway — permission status and the kill switch are both local to
 * this machine) — same pattern as PairedDevicesSection.tsx, not the
 * SettingsView-batched-config pattern, since toggling the kill switch is
 * immediate/safety-relevant, not something to queue behind "Save settings".
 * See notes/automation/workflows-design.md §6.4/§8.2.
 */
export function AutomationSection() {
  const { t } = useI18n();
  const [permissions, setPermissions] = useState<DesktopPermissions | null>(null);
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [perms, s] = await Promise.all([window.yggdrasil.automation.getPermissions(), window.yggdrasil.automation.getSettings()]);
      setPermissions(perms);
      setSettings(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPermission = async (kind: PermissionKind) => {
    await window.yggdrasil.automation.requestPermission(kind);
    // No programmatic re-prompt on macOS — this just opens System Settings;
    // re-check on return.
    await load();
  };

  const togglePaused = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const next = { ...settings, paused: !settings.paused };
      await window.yggdrasil.automation.saveSettings(next);
      setSettings(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>{t("set.automation.title")}</h3>
      <p className="muted">
        {t("set.automation.intro")}
      </p>

      {error && <p className="error">{error}</p>}
      {!permissions && !settings && !error && <p className="muted">{t("set.automation.loading")}</p>}

      {permissions && (
        <>
          <h4>{t("set.automation.macPerms")}</h4>
          {(Object.keys(PERMISSION_LABEL) as PermissionKind[]).map((kind) => (
            <div key={kind} className="settings-provider">
              <div className="mcp-server-header">
                <strong>{t(PERMISSION_LABEL[kind])}</strong>
                <span className="muted">{t(statusLabel(permissions[kind]))}</span>
              </div>
              {permissions[kind] !== "granted" && permissions[kind] !== "unsupported" && (
                <button type="button" className="link-btn" onClick={() => void requestPermission(kind)}>
                  {t("set.automation.openSettings")}
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {settings && (
        <>
          <h4>{t("set.automation.kill")}</h4>
          <div className="settings-provider">
            <div className="mcp-server-header">
              <strong>{settings.paused ? t("set.automation.paused") : t("set.automation.running")}</strong>
              <button type="button" className="icon-btn" onClick={() => void togglePaused()} disabled={saving}>
                {saving ? t("set.automation.saving") : settings.paused ? t("set.automation.resume") : t("set.automation.pauseAll")}
              </button>
            </div>
            <p className="muted">
              {t("set.automation.killHelp")}
            </p>
          </div>
        </>
      )}

      <h4>{t("set.automation.webhook")}</h4>
      <p className="muted">
        {t("set.automation.webhookHelp")}
      </p>
    </section>
  );
}
