import "./onboarding.css";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/index.js";
import { getLanguage, useI18n } from "../i18n/index.js";
import type { CliId, DetectedCli, OnboardingSettings } from "../types.js";
import type { WizardDraft, WizardUpdate } from "./draft.js";
import { closeWizard, saveOnboarding, useOnboarding } from "./store.js";
import { AgentsStep } from "./steps/AgentsStep.js";
import { EditorStep } from "./steps/EditorStep.js";
import { ModelsStep } from "./steps/ModelsStep.js";
import { SummaryStep } from "./steps/SummaryStep.js";

/** Bump together with ONBOARDING_VERSION in main/onboardingSettings.ts. */
const ONBOARDING_VERSION = 1;
const TOTAL_STEPS = 4;

export function OnboardingWizard() {
  const { t } = useI18n();
  const { settings } = useOnboarding();

  const [step, setStep] = useState(0);
  const [clis, setClis] = useState<DetectedCli[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<WizardDraft>(() => ({
    language: getLanguage(),
    enabled: (settings?.enabledHarnesses ?? []) as CliId[],
    usage: settings?.usage ?? [],
    ideId: null,
    ideLabel: null,
    ollamaModel: null,
  }));

  const update: WizardUpdate = useCallback((patch) => setDraft((d) => ({ ...d, ...patch })), []);

  // Start from the IDE already configured (re-running from Settings), if any.
  const [ideLoaded, setIdeLoaded] = useState(false);
  const [hadIde, setHadIde] = useState(false);
  useEffect(() => {
    void window.yggdrasil.ide.getSettings().then(async (ide) => {
      if (ide.configuredId) {
        const catalog = await window.yggdrasil.ide.listCatalog().catch(() => []);
        const label = ide.configuredId === "custom" ? (ide.customLabel ?? "Custom") : catalog.find((c) => c.id === ide.configuredId)?.label;
        update({ ideId: ide.configuredId, ideLabel: label ?? ide.configuredId });
        setHadIde(true);
      }
      setIdeLoaded(true);
    }).catch(() => setIdeLoaded(true));
  }, [update]);

  const finish = async (skipped: boolean) => {
    setBusy(true);
    try {
      if (!skipped) {
        const ide = await window.yggdrasil.ide.getSettings();
        if (draft.ideId !== ide.configuredId) {
          await window.yggdrasil.ide.saveSettings({ ...ide, configuredId: draft.ideId });
        }
      }
      const next: OnboardingSettings = {
        completedAt: new Date().toISOString(),
        version: ONBOARDING_VERSION,
        language: draft.language,
        // Skipping leaves nothing filtered; a finished wizard records the choice.
        enabledHarnesses: skipped ? (settings?.enabledHarnesses ?? null) : draft.enabled,
        usage: skipped ? (settings?.usage ?? []) : draft.usage,
        showAllClis: settings?.showAllClis ?? false,
      };
      await saveOnboarding(next);
      closeWizard();
    } finally {
      setBusy(false);
    }
  };

  const last = step === TOTAL_STEPS - 1;

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label={t("ob.title")}>
      <div className="onboarding-card-shell">
        <header className="onboarding-header">
          <div>
            <h1>{t("ob.title")}</h1>
            <p className="muted">{t("ob.subtitle")}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void finish(true)} disabled={busy}>
            {t("ob.skip")}
          </Button>
        </header>

        <div className="onboarding-progress" aria-hidden>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span key={i} className={i <= step ? "on" : ""} />
          ))}
        </div>

        <div className="onboarding-body">
          {step === 0 && (
            <AgentsStep
              draft={draft}
              update={update}
              clis={clis}
              onClis={setClis}
              preselectInstalled={settings?.enabledHarnesses == null}
            />
          )}
          {step === 1 && <ModelsStep draft={draft} update={update} />}
          {step === 2 && ideLoaded && <EditorStep draft={draft} update={update} recommendFirst={!hadIde} />}
          {step === 3 && <SummaryStep draft={draft} clis={clis} />}
        </div>

        <footer className="onboarding-footer">
          <span className="muted">{t("ob.step", { current: step + 1, total: TOTAL_STEPS })}</span>
          <div className="onboarding-footer-actions">
            {step > 0 && (
              <Button onClick={() => setStep(step - 1)} disabled={busy}>
                {t("ob.back")}
              </Button>
            )}
            {last ? (
              <Button variant="primary" onClick={() => void finish(false)} disabled={busy}>
                {t("ob.finish")}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setStep(step + 1)}>
                {t("ob.next")}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
