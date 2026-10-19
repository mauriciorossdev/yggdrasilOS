import type { ConfigShape, HarnessInfo } from "../../types.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
  harnesses: HarnessInfo[];
};

export function HarnessSection({ config, setConfig, harnesses }: Props) {
  return (
    <section className="settings-section">
      <h3>Harness</h3>
      <label>
        Policy
        <select
          value={config.harness?.policy ?? "auto"}
          onChange={(e) => setConfig({ ...config, harness: { ...config.harness, policy: e.target.value } })}
        >
          <option value="auto">auto</option>
          <option value="pinned">pinned</option>
        </select>
      </label>
      {config.harness?.policy === "pinned" && (
        <label>
          Pinned harness
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
