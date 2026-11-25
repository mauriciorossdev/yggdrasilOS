import { LANGUAGES, setLanguage, type Language } from "../../i18n/index.js";
import type { WizardDraft, WizardUpdate } from "../draft.js";
import { Option } from "./Option.js";

/** Each language describes itself in its own words, so the choice reads right whatever the UI is in now. */
const SELF: Record<Language, string> = { es: "Seguimos en español", en: "Continue in English" };

export function LanguageStep({ draft, update }: { draft: WizardDraft; update: WizardUpdate }) {
  const choose = (language: Language) => {
    if (language === draft.language) return;
    setLanguage(language); // the rest of the wizard switches immediately
    update({ language });
  };
  return (
    <div className="ob-options" role="radiogroup">
      {LANGUAGES.map((l) => (
        <Option key={l.id} kind="radio" big selected={draft.language === l.id} onSelect={() => choose(l.id)} label={l.label} sub={SELF[l.id]} />
      ))}
    </div>
  );
}
