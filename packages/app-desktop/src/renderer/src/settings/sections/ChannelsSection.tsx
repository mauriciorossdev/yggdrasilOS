import type { ConfigShape } from "../../types.js";

type Props = {
  config: ConfigShape;
  setConfig: (config: ConfigShape) => void;
};

export function ChannelsSection({ config, setConfig }: Props) {
  const toggleChannel = (id: string, enabled: boolean) => {
    setConfig({
      ...config,
      channels: { ...config.channels, [id]: { ...config.channels?.[id], enabled } },
    });
  };

  const entries = Object.entries(config.channels ?? {});

  return (
    <section className="settings-section">
      <h3>Channels</h3>
      {entries.map(([id, ch]) => (
        <label key={id} className="checkbox-row">
          <input type="checkbox" checked={ch.enabled !== false} onChange={(e) => toggleChannel(id, e.target.checked)} />
          {id}
        </label>
      ))}
      {entries.length === 0 && <p className="muted">No channels configured</p>}
    </section>
  );
}
