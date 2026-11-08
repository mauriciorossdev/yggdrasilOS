import type { ConfigShape } from "../../types.js";
import { useI18n } from "../../i18n/index.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
};

export function ChannelsSection({ config, setConfig }: Props) {
  const { t } = useI18n();
  const toggleChannel = (id: string, enabled: boolean) => {
    setConfig({
      ...config,
      channels: { ...config.channels, [id]: { ...config.channels?.[id], enabled } },
    });
  };

  const entries = Object.entries(config.channels ?? {});

  return (
    <section className="settings-section">
      <h3>{t("set.channels.title")}</h3>
      {entries.map(([id, ch]) => (
        <label key={id} className="checkbox-row">
          <input type="checkbox" checked={ch.enabled !== false} onChange={(e) => toggleChannel(id, e.target.checked)} />
          {id}
        </label>
      ))}
      {entries.length === 0 && <p className="muted">{t("set.channels.none")}</p>}
    </section>
  );
}
