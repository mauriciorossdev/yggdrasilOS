import { useEffect, useRef } from "react";
import { useI18n } from "../../i18n/index.js";
import type { WizardDraft, WizardUpdate } from "../draft.js";

export function NameStep({ draft, update }: { draft: WizardDraft; update: WizardUpdate }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  return (
    <input
      ref={input}
      id="ob-name"
      className="ob-input ob-input--big"
      autoComplete="given-name"
      maxLength={40}
      placeholder={t("ob.name.ph")}
      aria-label={t("ob.name.ph")}
      value={draft.userName}
      onChange={(e) => update({ userName: e.target.value })}
    />
  );
}
