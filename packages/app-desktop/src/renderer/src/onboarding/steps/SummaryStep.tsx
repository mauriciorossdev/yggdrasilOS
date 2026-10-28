import { Card } from "../../ui/index.js";
import { useI18n } from "../../i18n/index.js";
import type { DetectedCli } from "../../types.js";
import type { WizardDraft } from "../draft.js";

export function SummaryStep({ draft, clis }: { draft: WizardDraft; clis: DetectedCli[] | null }) {
  const { t } = useI18n();
  const agentLabels = draft.enabled.map((id) => clis?.find((c) => c.id === id)?.label ?? id);
  const models = [
    ...(draft.usage.includes("local") && draft.ollamaModel ? [`Ollama · ${draft.ollamaModel}`] : []),
    ...(draft.usage.includes("api") ? ["API key"] : []),
  ];
  const nothing = agentLabels.length === 0 && models.length === 0;

  return (
    <div className="onboarding-step">
      <h2>{t("ob.s4.title")}</h2>
      <Card className="onboarding-card onboarding-card--wide">
        <dl className="onboarding-summary">
          <dt>{t("ob.sum.agents")}</dt>
          <dd>{agentLabels.length > 0 ? agentLabels.join(", ") : t("ob.sum.none")}</dd>
          <dt>{t("ob.sum.models")}</dt>
          <dd>{models.length > 0 ? models.join(", ") : t("ob.sum.none")}</dd>
          <dt>{t("ob.sum.editor")}</dt>
          <dd>{draft.ideLabel ?? t("ob.sum.none")}</dd>
        </dl>
      </Card>
      {nothing && <p className="muted">{t("ob.sum.warn")}</p>}
    </div>
  );
}
