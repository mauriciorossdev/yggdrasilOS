import { useEffect, useState } from "react";
import type { DashboardLayout, PluginRecord, WidgetInstance } from "../types.js";
import { useI18n } from "../i18n/index.js";
import { Button, Modal } from "../ui/index.js";
import { setActiveTab, useActiveTab } from "../ui/mainTabsStore.js";
import { catalogWidgets, moveInstance, newInstance } from "./dashboardLogic.js";
import { WidgetCard } from "./WidgetCard.js";
import { WidgetConfigDialog } from "./WidgetConfigDialog.js";

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** The one Dashboard of the app: the same cards in every window. */
export function DashboardView({ plugins, version }: { plugins: PluginRecord[]; version: number }) {
  const { t } = useI18n();
  const active = useActiveTab() === "dashboard";
  const visible = useDocumentVisible() && active;
  // Widgets load the first time the tab is opened, then stay mounted like every other tab.
  const [opened, setOpened] = useState(active);
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [config, setConfig] = useState<{ instance: WidgetInstance; existing: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (active) setOpened(true);
  }, [active]);

  useEffect(() => {
    void window.yggdrasil.dashboard.get().then(setLayout);
    return window.yggdrasil.dashboard.onChanged(setLayout);
  }, []);

  const widgets = catalogWidgets(plugins);
  const byKey = new Map(widgets.map((p) => [p.key, p]));
  const instances = layout?.instances ?? [];

  const add = (plugin: PluginRecord) => {
    setPicking(false);
    setConfig({ instance: newInstance(plugin, crypto.randomUUID()), existing: false });
  };

  const save = (next: WidgetInstance[]) => {
    setLayout({ instances: next });
    window.yggdrasil.dashboard.save({ instances: next }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const configPlugin = config ? byKey.get(config.instance.pluginKey) : undefined;
  const openStudio = (
    <Button
      variant="primary"
      onClick={() => {
        setPicking(false);
        setActiveTab("studio");
      }}
    >
      {t("dashboard.empty.openStudio")}
    </Button>
  );

  const catalog = widgets.length === 0 ? (
    <>
      <p className="muted">{t("dashboard.catalog.none")}</p>
      {openStudio}
    </>
  ) : (
    <ul className="dash-catalog">
      {widgets.map((p) => (
        <li key={p.key}>
          <button type="button" className="dash-catalog-item" onClick={() => add(p)}>
            <strong>
              {p.manifest.icon} {p.manifest.name}
            </strong>
            {p.manifest.description && <span className="muted">{p.manifest.description}</span>}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="dash">
      <header className="dash-head">
        <h1>{t("dashboard.title")}</h1>
        {instances.length > 0 && (
          <>
            <Button onClick={() => setEditing((e) => !e)}>{editing ? t("dashboard.edit.done") : t("dashboard.edit.start")}</Button>
            <Button variant="primary" onClick={() => setPicking(true)}>
              {t("dashboard.add")}
            </Button>
          </>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {layout && instances.length === 0 && (
        <div className="dash-empty">
          <h2>{t("dashboard.empty.title")}</h2>
          <p className="muted">{t("dashboard.empty.body")}</p>
          {catalog}
        </div>
      )}
      {opened && instances.length > 0 && (
        <div className="dash-grid">
          {/* Stable DOM order, positions through CSS `order`: moving an iframe in the DOM would reload it. */}
          {[...instances]
            .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
            .map((instance) => {
              const order = instances.indexOf(instance);
              return (
                <WidgetCard
                  key={instance.instanceId}
                  instance={instance}
                  plugin={byKey.get(instance.pluginKey)}
                  version={version}
                  visible={visible}
                  order={order}
                  count={instances.length}
                  editing={editing}
                  onConfigure={() => setConfig({ instance, existing: true })}
                  onRemove={() => save(instances.filter((i) => i.instanceId !== instance.instanceId))}
                  onMove={(to) => save(moveInstance(instances, instance.instanceId, to))}
                  onDrop={(id) => save(moveInstance(instances, id, order))}
                  onResize={(size) => save(instances.map((i) => (i.instanceId === instance.instanceId ? { ...i, size } : i)))}
                />
              );
            })}
        </div>
      )}
      {picking && (
        <Modal title={t("dashboard.catalog.title")} onClose={() => setPicking(false)}>
          {catalog}
        </Modal>
      )}
      {config && configPlugin && (
        <WidgetConfigDialog
          plugin={configPlugin}
          version={version}
          instance={config.instance}
          existing={config.existing}
          onClose={() => setConfig(null)}
          onRemove={() => {
            save(instances.filter((i) => i.instanceId !== config.instance.instanceId));
            setConfig(null);
          }}
        />
      )}
    </div>
  );
}
