import type { ConfigShape } from "../../types.js";
import { LANGUAGES, useI18n } from "../../i18n/index.js";
import { saveOnboarding, useOnboarding } from "../../onboarding/store.js";
import { setShowWorkflows, useShowWorkflows } from "../../ui/sidebarStore.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
};

export function GeneralSection({ config, setConfig }: Props) {
  const { t } = useI18n();
  const showWorkflows = useShowWorkflows();
  const onboarding = useOnboarding();
  return (
    <section className="settings-section">
      <h3>{t("set.general.title")}</h3>
      <label>
        {t("set.general.uiLanguage")}
        <select
          value={onboarding.settings?.language ?? ""}
          disabled={!onboarding.settings}
          onChange={(e) => {
            // Applies right away (and tells the main process for native dialogs/menus); not part of "Save settings".
            if (onboarding.settings) void saveOnboarding({ ...onboarding.settings, language: e.target.value || null });
          }}
        >
          <option value="">{t("set.general.uiLanguageSystem")}</option>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">{t("set.general.uiLanguageHelp")}</p>
      <label>
        {t("set.general.language")}
        <input
          type="text"
          value={config.language ?? ""}
          onChange={(e) => setConfig({ ...config, language: e.target.value })}
          placeholder={t("set.general.languagePlaceholder")}
        />
      </label>
      <p className="muted">
        {t("set.general.languageHelp")}
      </p>
      <label className="settings-check">
        <input type="checkbox" checked={showWorkflows} onChange={(e) => setShowWorkflows(e.target.checked)} />
        {t("set.general.showWorkflows")}
      </label>
      <p className="muted">
        {t("set.general.showWorkflowsHelp")}
      </p>
    </section>
  );
}
