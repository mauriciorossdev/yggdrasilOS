import type { ConfigShape, HarnessInfo } from "../../types.js";
import { useI18n } from "../../i18n/index.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  harnesses: HarnessInfo[];
};

export function HarnessSection({ config, setConfig, harnesses }: Props) {
  const { t } = useI18n();
  return (
    <section className="settings-section">
      <h3>{t("set.harness.title")}</h3>
      <label>
        {t("set.harness.policy")}
        <select
          value={config.harness?.policy ?? "auto"}
          onChange={(e) => setConfig({ ...config, harness: { ...config.harness, policy: e.target.value } })}
        >
          <option value="auto">{t("set.harness.auto")}</option>
          <option value="pinned">{t("set.harness.pinned")}</option>
        </select>
      </label>
      {config.harness?.policy === "pinned" && (
        <label>
          {t("set.harness.pinnedHarness")}
          <select
            value={config.harness?.pinnedId ?? ""}
            onChange={(e) => setConfig({ ...config, harness: { ...config.harness, pinnedId: e.target.value } })}
          >
            {harnesses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}
