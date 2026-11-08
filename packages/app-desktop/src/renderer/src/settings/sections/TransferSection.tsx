import { useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { useI18n } from "../../i18n/index.js";
import type { ConfigGetResult } from "../../types.js";

/**
 * Export/import of every setting as one Markdown file (see main/settingsTransfer.ts).
 * Desktop-local settings are merged in main; the gateway part goes through
 * config.patch so it hot-reloads and merges per provider/agent.
 */
export function TransferSection() {
  const { t } = useI18n();
  const { call } = useGateway();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (task: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await task());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const exportSettings = () =>
    run(async () => {
      const cfg = await call<ConfigGetResult>("config.get");
      const res = await window.yggdrasil.settingsTransfer.exportSettings(cfg.workspaceRoot, includeSecrets);
      return res ? t("set.transfer.exported", { path: res.path }) : null;
    });

  const importSettings = () =>
    run(async () => {
      const res = await window.yggdrasil.settingsTransfer.importSettings();
      if (!res) return null;
      let gatewayKeys: string[] = [];
      if (res.gateway && Object.keys(res.gateway).length > 0) {
        await call("config.patch", res.gateway);
        gatewayKeys = Object.keys(res.gateway);
      }
      const parts = [
        res.desktopKeys.length ? t("set.transfer.desktop", { keys: res.desktopKeys.join(", ") }) : null,
        gatewayKeys.length ? t("set.transfer.gateway", { keys: gatewayKeys.join(", ") }) : null,
      ].filter(Boolean);
      const applied = parts.length ? t("set.transfer.imported", { parts: parts.join(" · ") }) : t("set.transfer.nothing");
      return res.warnings.length ? t("set.transfer.warnings", { applied, warnings: res.warnings.join("; ") }) : applied;
    });

  return (
    <section className="settings-section">
      <h3>{t("set.transfer.title")}</h3>
      <p className="muted">
        {t("set.transfer.intro")}
      </p>

      <label className="settings-check">
        <input type="checkbox" checked={includeSecrets} disabled={busy} onChange={(e) => setIncludeSecrets(e.target.checked)} />
        {t("set.transfer.secrets")}
      </label>
      {includeSecrets && <p className="error">{t("set.transfer.secretsWarn")}</p>}

      <div className="agent-form-actions">
        <button type="button" disabled={busy} onClick={() => void exportSettings()}>
          {t("set.transfer.export")}
        </button>
        <button type="button" disabled={busy} onClick={() => void importSettings()}>
          {t("set.transfer.import")}
        </button>
      </div>

      {message && <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
