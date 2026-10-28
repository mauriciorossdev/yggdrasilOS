import { useEffect, useState } from "react";
import { Card } from "../../ui/index.js";
import { useI18n } from "../../i18n/index.js";
import type { DetectedIde } from "../../types.js";
import type { WizardDraft, WizardUpdate } from "../draft.js";

type Props = { draft: WizardDraft; update: WizardUpdate; recommendFirst: boolean };

export function EditorStep({ draft, update, recommendFirst }: Props) {
  const { t } = useI18n();
  const [ides, setIdes] = useState<DetectedIde[] | null>(null);

  useEffect(() => {
    void window.yggdrasil.ide
      .detectInstalled()
      .then((list) => {
        setIdes(list);
        const first = list.find((i) => i.installed);
        if (recommendFirst && draft.ideId === null && first) update({ ideId: first.id, ideLabel: first.label });
      })
      .catch(() => setIdes([]));
    // Detect once on first show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const installed = (ides ?? []).filter((i) => i.installed);

  return (
    <div className="onboarding-step">
      <h2>{t("ob.s3.title")}</h2>
      <p className="muted">{t("ob.ide.hint")}</p>

      {ides !== null && installed.length === 0 && <p className="muted">{t("ob.ide.noneDetected")}</p>}

      <div className="onboarding-grid">
        {installed.map((ide) => (
          <Card key={ide.id} accent={draft.ideId === ide.id} className="onboarding-card">
            <label className="onboarding-check">
              <input
                type="radio"
                name="onboarding-ide"
                checked={draft.ideId === ide.id}
                onChange={() => update({ ideId: ide.id, ideLabel: ide.label })}
              />
              <strong>{ide.label}</strong>
            </label>
          </Card>
        ))}
        <Card accent={draft.ideId === null} className="onboarding-card">
          <label className="onboarding-check">
            <input
              type="radio"
              name="onboarding-ide"
              checked={draft.ideId === null}
              onChange={() => update({ ideId: null, ideLabel: null })}
            />
            <strong>{t("ob.ide.none")}</strong>
          </label>
        </Card>
      </div>
    </div>
  );
}
