import { useCallback, useEffect, useState } from "react";
import { Button, Card, Chip } from "../../ui/index.js";
import { LANGUAGES, setLanguage, useI18n, type Language } from "../../i18n/index.js";
import type { DetectedCli } from "../../types.js";
import { toggle, type WizardDraft, type WizardUpdate } from "../draft.js";

type Props = {
  draft: WizardDraft;
  update: WizardUpdate;
  clis: DetectedCli[] | null;
  onClis: (clis: DetectedCli[]) => void;
  /** True when no saved choice exists, so installed CLIs should start checked. */
  preselectInstalled: boolean;
};

export function AgentsStep({ draft, update, clis, onClis, preselectInstalled }: Props) {
  const { t } = useI18n();
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(
    async (preselect: boolean) => {
      setScanning(true);
      try {
        const found = await window.yggdrasil.onboarding.detectClis();
        onClis(found);
        if (preselect) update({ enabled: found.filter((c) => c.installed).map((c) => c.id) });
      } catch {
        onClis([]);
      } finally {
        setScanning(false);
      }
    },
    [onClis, update],
  );

  useEffect(() => {
    if (clis === null) void scan(preselectInstalled);
    // Scan once on first show; re-scans are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeLanguage = (language: Language) => {
    setLanguage(language);
    update({ language });
  };

  return (
    <div className="onboarding-step">
      <h2>{t("ob.s1.title")}</h2>

      <label className="onboarding-field">
        <span>{t("ob.language")}</span>
        <select value={draft.language} onChange={(e) => changeLanguage(e.target.value as Language)}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <div className="onboarding-section-head">
        <div>
          <h3>{t("ob.cli.title")}</h3>
          <p className="muted">{t("ob.cli.hint")}</p>
        </div>
        <Button size="sm" onClick={() => void scan(false)} disabled={scanning}>
          {scanning ? t("ob.scanning") : t("ob.scan")}
        </Button>
      </div>

      <div className="onboarding-grid">
        {(clis ?? []).map((cli) => {
          const checked = draft.enabled.includes(cli.id);
          return (
            <Card key={cli.id} accent={checked} className="onboarding-card">
              <label className="onboarding-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => update({ enabled: toggle(draft.enabled, cli.id, e.target.checked) })}
                />
                <strong>{cli.label}</strong>
              </label>
              {cli.installed ? (
                <Chip tone="ready">
                  {cli.version ? t("ob.cli.installedV", { version: cli.version }) : t("ob.cli.installed")}
                </Chip>
              ) : (
                <div className="onboarding-card-row">
                  <Chip tone="neutral">{t("ob.cli.missing")}</Chip>
                  {cli.installUrl && (
                    <button
                      type="button"
                      className="onboarding-link"
                      onClick={() => void window.yggdrasil.onboarding.openExternal(cli.installUrl as string)}
                    >
                      {t("ob.cli.install")}
                    </button>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
