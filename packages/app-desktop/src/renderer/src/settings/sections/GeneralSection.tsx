import type { ConfigShape } from "../../types.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
};

export function GeneralSection({ config, setConfig }: Props) {
  return (
    <section className="settings-section">
      <h3>General</h3>
      <label>
        Response language
        <input
          type="text"
          value={config.language ?? ""}
          onChange={(e) => setConfig({ ...config, language: e.target.value })}
          placeholder="e.g. Spanish, français, 日本語 — leave blank for no preference"
        />
      </label>
      <p className="muted">
        Every agent in this project is told to reply in this language, on top of whatever its own system
        prompt already says. Leave blank to let the model respond however it normally would.
      </p>
    </section>
  );
}
