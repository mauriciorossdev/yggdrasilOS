import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/index.js";
import type { DetectedIde } from "../../types.js";
import type { WizardDraft, WizardUpdate } from "../draft.js";
import { Option } from "./Option.js";

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
    <div className="ob-options" role="radiogroup">
      {ides === null && <p className="ob-muted">{t("ob.scanning")}</p>}
      {ides !== null && installed.length === 0 && <p className="ob-muted">{t("ob.ide.noneDetected")}</p>}
      {installed.map((ide) => (
        <Option
          key={ide.id}
          kind="radio"
          selected={draft.ideId === ide.id}
          onSelect={() => update({ ideId: ide.id, ideLabel: ide.label })}
          label={ide.label}
          meta={t("ob.ide.found")}
          metaTone="ok"
        />
      ))}
      <Option kind="radio" selected={draft.ideId === null} onSelect={() => update({ ideId: null, ideLabel: null })} label={t("ob.ide.none")} />
    </div>
  );
}
