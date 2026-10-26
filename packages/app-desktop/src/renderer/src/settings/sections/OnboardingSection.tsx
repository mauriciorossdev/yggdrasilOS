import { Button } from "../../ui/index.js";
import { useI18n } from "../../i18n/index.js";
import { openWizard, saveOnboarding, useOnboarding } from "../../onboarding/store.js";

/** Settings → Setup: reopen the first-run wizard and control whether menus filter CLIs. */
export function OnboardingSection() {
  const { t } = useI18n();
  const { settings } = useOnboarding();
  const hasChoice = settings?.enabledHarnesses != null;

  return (
    <section className="settings-section">
      <h3>{t("ob.settings.title")}</h3>
      <p className="muted">{t("ob.settings.desc")}</p>
      <div>
        <Button onClick={openWizard}>{t("ob.settings.open")}</Button>
      </div>
      {hasChoice && settings && (
        <label className="onboarding-inline-check">
          <input
            type="checkbox"
            checked={settings.showAllClis}
            onChange={(e) => void saveOnboarding({ ...settings, showAllClis: e.target.checked })}
          />
          {t("ob.settings.showAll")}
        </label>
      )}
    </section>
  );
}
