import { useEffect, useState } from "react";
import type { AutomationSettings, DesktopPermissions, PermissionKind, PermissionState } from "../../types.js";

const PERMISSION_LABEL: Record<PermissionKind, string> = { screen: "Screen Recording", accessibility: "Accessibility" };

function statusLabel(state: PermissionState): string {
  switch (state) {
    case "granted":
      return "Granted";
    case "denied":
      return "Denied";
    case "not-determined":
      return "Not requested yet";
    case "restricted":
      return "Restricted";
    case "unsupported":
      return "Not supported on this OS";
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
      <h3>Automation</h3>
      <p className="muted">
        Permissions and the kill switch for Yggdrasil's own workflow automations (open apps, screenshots, scheduled
        runs) — see the Workflows tab. This build isn't code-signed, so macOS forgets Screen Recording after every
        update; you'll need to re-grant it then.
      </p>

      {error && <p className="error">{error}</p>}
      {!permissions && !settings && !error && <p className="muted">Loading…</p>}

      {permissions && (
        <>
          <h4>macOS permissions</h4>
          {(Object.keys(PERMISSION_LABEL) as PermissionKind[]).map((kind) => (
            <div key={kind} className="settings-provider">
              <div className="mcp-server-header">
                <strong>{PERMISSION_LABEL[kind]}</strong>
                <span className="muted">{statusLabel(permissions[kind])}</span>
              </div>
              {permissions[kind] !== "granted" && permissions[kind] !== "unsupported" && (
                <button type="button" className="link-btn" onClick={() => void requestPermission(kind)}>
                  Open Settings
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {settings && (
        <>
          <h4>Kill switch</h4>
          <div className="settings-provider">
            <div className="mcp-server-header">
              <strong>{settings.paused ? "All automations paused" : "Automations running normally"}</strong>
              <button type="button" className="icon-btn" onClick={() => void togglePaused()} disabled={saving}>
                {saving ? "Saving…" : settings.paused ? "Resume" : "Pause all"}
              </button>
            </div>
            <p className="muted">
              Blocks every workflow run — manual, scheduled, event-triggered or webhook — until turned back off.
            </p>
          </div>
        </>
      )}

      <h4>Webhook secrets</h4>
      <p className="muted">
        A workflow's webhook trigger reads its secret from an environment variable on this machine (the trigger's
        "secret env var" field in the Workflows tab), never from a value stored here — set it before starting
        Yggdrasil and restart the app for it to take effect.
      </p>
    </section>
  );
}
