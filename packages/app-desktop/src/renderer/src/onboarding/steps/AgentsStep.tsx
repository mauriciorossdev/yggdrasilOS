import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/index.js";
import type { DetectedCli } from "../../types.js";
import { toggle, type WizardDraft, type WizardUpdate } from "../draft.js";
import { Option } from "./Option.js";

type Props = {
  draft: WizardDraft;
  update: WizardUpdate;
  clis: DetectedCli[] | null;
  onClis: (clis: DetectedCli[]) => void;
  /** True when no saved choice exists, so installed CLIs should start checked. */
  preselectInstalled: boolean;
};

export function AgentsStep({ draft, update, clis, onClis, preselectInstalled }: Props) {
  const { t } = useI18n();
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(
    async (preselect: boolean) => {
      setScanning(true);
      try {
        // omp isn't offered during onboarding (still selectable via "show all CLIs" in Settings).
        const found = (await window.yggdrasil.onboarding.detectClis()).filter((c) => c.id !== "omp");
        onClis(found);
        if (preselect) update({ enabled: found.filter((c) => c.installed).map((c) => c.id) });
      } catch {
        onClis([]);
      } finally {
        setScanning(false);
      }
    },
    [onClis, update],
  );

  useEffect(() => {
    if (clis === null) void scan(preselectInstalled);
    // Scan once on first show; re-scans are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="ob-options">
        {clis === null && <p className="ob-muted">{t("ob.scanning")}</p>}
        {clis !== null && clis.length === 0 && <p className="ob-muted">{t("ob.cli.none")}</p>}
        {(clis ?? []).map((cli) => (
          <Option
            key={cli.id}
            kind="check"
            selected={draft.enabled.includes(cli.id)}
            onSelect={() => update({ enabled: toggle(draft.enabled, cli.id, !draft.enabled.includes(cli.id)) })}
            label={cli.label}
            meta={
              cli.installed ? (
                cli.version ? t("ob.cli.installedV", { version: cli.version }) : t("ob.cli.installed")
              ) : (
                <>
                  {t("ob.cli.missing")}
                  {cli.installUrl && (
                    <>
                      {" · "}
                      <span
                        role="link"
                        tabIndex={0}
                        className="ob-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          void window.yggdrasil.onboarding.openExternal(cli.installUrl as string);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.stopPropagation();
                          void window.yggdrasil.onboarding.openExternal(cli.installUrl as string);
                        }}
                      >
                        {t("ob.cli.install")} ↗
                      </span>
                    </>
                  )}
                </>
              )
            }
            metaTone={cli.installed ? "ok" : "warn"}
          />
        ))}
      </div>
      <button type="button" className="ob-quiet" onClick={() => void scan(false)} disabled={scanning}>
        {scanning ? t("ob.scanning") : t("ob.scan")}
      </button>
    </>
  );
}
