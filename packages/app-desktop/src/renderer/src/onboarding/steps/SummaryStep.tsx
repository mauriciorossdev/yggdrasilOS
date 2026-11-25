import { LANGUAGES, useI18n } from "../../i18n/index.js";
import type { DetectedCli } from "../../types.js";
import type { WizardDraft } from "../draft.js";

type Props = { draft: WizardDraft; clis: DetectedCli[] | null; skipped: ReadonlySet<string> };

export function SummaryStep({ draft, clis, skipped }: Props) {
  const { t } = useI18n();
  const agents = draft.enabled.map((id) => clis?.find((c) => c.id === id)?.label ?? id);
  const models = [
    ...(draft.usage.includes("cli") ? [t("ob.models.cli")] : []),
    ...(draft.usage.includes("local") && draft.ollamaModel ? [`Ollama · ${draft.ollamaModel}`] : []),
    ...(draft.usage.includes("api") ? [`API · ${draft.apiProviders.length ? draft.apiProviders.join(" + ") : "—"}`] : []),
  ];
  const row = (step: string, label: string, value: string) => (
    <>
      <dt>{label}</dt>
      {skipped.has(step) ? <dd className="ob-skip">{t("ob.sum.skipped")}</dd> : <dd>{value || t("ob.sum.none")}</dd>}
    </>
  );
  return (
    <dl className="ob-summary">
      {row("lang", t("ob.sum.lang"), LANGUAGES.find((l) => l.id === draft.language)?.label ?? draft.language)}
      {row("name", t("ob.sum.name"), draft.userName.trim())}
      {row("agents", t("ob.sum.agents"), agents.join(", "))}
      {row("models", t("ob.sum.models"), models.join(", "))}
      {row("editor", t("ob.sum.editor"), draft.ideLabel ?? "")}
    </dl>
  );
}
