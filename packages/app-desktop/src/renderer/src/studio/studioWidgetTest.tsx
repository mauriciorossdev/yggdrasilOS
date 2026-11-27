// The Estudio's "preview as widget": size and test settings for a throwaway
// instance. Secrets typed here stay in memory; nothing reaches the Dashboard.
import { useState } from "react";
import type { PluginRecord, WidgetDraft, WidgetInstance } from "../types.js";
import { useI18n } from "../i18n/index.js";
import { Button } from "../ui/index.js";
import { defaultConfig, newInstance } from "../dashboard/dashboardLogic.js";
import { SIZES } from "../dashboard/WidgetConfigDialog.js";
import { WidgetSettingsFields } from "../dashboard/WidgetSettingsFields.js";

const storageKey = (id: string) => `ygg.studio.widgetTest.${id}`;

function stored(id: string): Partial<WidgetInstance> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(id)) ?? "{}") as Partial<WidgetInstance>;
  } catch {
    return {};
  }
}

/** The caller remounts per plugin (key), so this state never leaks across complements. */
export function useWidgetTest(plugin: PluginRecord) {
  const id = plugin.manifest.id;
  const [changes, setChanges] = useState<Partial<WidgetInstance>>(() => stored(id));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const spec = plugin.manifest.widget;
  if (!spec) return null;

  // Defaults come from the current manifest, so fields the agent just added show up.
  const base = newInstance(plugin, `preview:${id}`);
  const instance: WidgetInstance = {
    ...base,
    ...changes,
    instanceId: base.instanceId,
    pluginKey: plugin.key,
    config: { ...defaultConfig(spec), ...changes.config },
  };
  const change = (next: WidgetInstance) => {
    const keep = { size: next.size, config: next.config, refreshSeconds: next.refreshSeconds, grantedDomains: next.grantedDomains };
    setChanges(keep);
    try {
      localStorage.setItem(storageKey(id), JSON.stringify(keep));
    } catch {
      // storage unavailable: test settings just won't survive a restart
    }
  };
  const draft: WidgetDraft = { instance, secrets };
  return { instance, draft, change, setSecret: (field: string, value: string) => setSecrets((s) => ({ ...s, [field]: value })) };
}

export function StudioWidgetControls({ plugin, test }: { plugin: PluginRecord; test: NonNullable<ReturnType<typeof useWidgetTest>> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { instance, change, setSecret } = test;
  return (
    <div className="studio-widget-controls">
      <div className="dash-sizes" role="group" aria-label={t("dashboard.config.size")}>
        {SIZES.map((size) => (
          <Button key={size} size="sm" variant={instance.size === size ? "primary" : "secondary"} aria-pressed={instance.size === size} onClick={() => change({ ...instance, size })}>
            {size.toUpperCase()}
          </Button>
        ))}
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {t("dashboard.preview.testSettings")}
        </Button>
      </div>
      {/* Kept mounted while folded so typed test keys stay in the form. */}
      <div className="studio-widget-form" hidden={!open}>
        <WidgetSettingsFields plugin={plugin} instance={instance} onChange={change} onSecret={setSecret} savedSecrets={{}} />
      </div>
    </div>
  );
}
