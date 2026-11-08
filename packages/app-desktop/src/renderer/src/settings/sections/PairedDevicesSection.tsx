import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { useI18n } from "../../i18n/index.js";

type ApiKeyEntry = {
  name: string;
  expiresAt?: number;
  keyPreview?: string;
};

// Own fetch/revoke cycle, separate from SettingsView's batched config.patch
// save flow — revoking is immediate and destructive (kills that device's
// connection right away), not something to queue behind "Save settings".
export function PairedDevicesSection() {
  const { t } = useI18n();
  const { call } = useGateway();
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await call<{ apiKeys: ApiKeyEntry[] }>("auth.apiKeys.list");
      setApiKeys(result.apiKeys ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revoke = async (name: string) => {
    if (
      !window.confirm(
        t("set.paired.confirm", { name }),
      )
    ) {
      return;
    }
    setRevoking(name);
    setError(null);
    try {
      await call("auth.apiKeys.revoke", { name });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <section className="settings-section">
      <h3>{t("set.paired.title")}</h3>
      <p className="muted">
        {t("set.paired.intro")}
      </p>

      {error && <p className="error">{error}</p>}
      {apiKeys === null && !error && <p className="muted">{t("set.paired.loading")}</p>}
      {apiKeys?.length === 0 && <p className="muted">{t("set.paired.none")}</p>}

      {apiKeys?.map((k) => (
        <div key={k.name} className="settings-provider">
          <div className="mcp-server-header">
            <strong>{k.name}</strong>
            <button
              type="button"
              className="icon-btn"
              onClick={() => void revoke(k.name)}
              disabled={revoking === k.name}
              title={t("set.paired.revokeTitle", { name: k.name })}
            >
              {revoking === k.name ? t("set.paired.revoking") : t("set.paired.revoke")}
            </button>
          </div>
          <p className="muted">
            {t("set.paired.keyEnding")} <code>{k.keyPreview ?? "····"}</code>
            {" · "}
            {k.expiresAt
              ? t("set.paired.expires", { date: new Date(k.expiresAt).toLocaleDateString() })
              : t("set.paired.neverExpires")}
          </p>
        </div>
      ))}
    </section>
  );
}
