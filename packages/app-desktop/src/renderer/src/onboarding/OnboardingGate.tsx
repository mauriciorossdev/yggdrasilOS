import { useEffect } from "react";
import { OnboardingWizard } from "./OnboardingWizard.js";
import { loadOnboarding, useOnboarding } from "./store.js";

/** Loads onboarding state once and shows the wizard when it should be on screen (fresh install, or opened from Settings). */
export function OnboardingGate() {
  const { open } = useOnboarding();
  useEffect(() => {
    void loadOnboarding();
  }, []);
  return open ? <OnboardingWizard /> : null;
}
