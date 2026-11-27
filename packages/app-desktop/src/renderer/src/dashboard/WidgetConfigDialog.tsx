import { useEffect, useState } from "react";
import type { PluginRecord, WidgetInstance, WidgetSize } from "../types.js";
import { useI18n } from "../i18n/index.js";
import { Button, Field, Input, Modal } from "../ui/index.js";
import { missingToSave, netDomainsOf } from "./dashboardLogic.js";
import { WidgetPreview } from "./WidgetPreview.js";
import { WidgetSettingsFields } from "./WidgetSettingsFields.js";

type Props = {
  plugin: PluginRecord;
  version: number;
  instance: WidgetInstance;
  /** False while adding. */
  existing: boolean;
  onClose: () => void;
  onRemove?: () => void;
};

export const SIZES: WidgetSize[] = ["s", "m", "l"];

export function WidgetConfigDialog({ plugin, version, instance: initial, existing, onClose, onRemove }: Props) {
  const { t } = useI18n();
  const [instance, setInstance] = useState(initial);
  // `secrets` (applied on blur) feed the preview; `typing` is what gets saved.
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [canStore, setCanStore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftId = `draft:${initial.instanceId}`;
  const needsSecret = plugin.manifest.widget!.fields.some((f) => f.type === "secret");

  useEffect(() => {
    void window.yggdrasil.dashboard.secretStatus(initial.instanceId).then((status) => {
      setSaved(status.saved);
      setCanStore(status.canStore);
    });
  }, [initial.instanceId]);

  const missing = missingToSave(plugin, instance, typing, saved);
  const blocked = missing.domains.length > 0 || missing.fields.length > 0 || (needsSecret && !canStore);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const domains = netDomainsOf(plugin);
      await window.yggdrasil.dashboard.commit(
        { ...instance, grantedDomains: instance.grantedDomains.filter((d) => domains.includes(d)) },
        typing,
        draftId,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={plugin.manifest.name}
      onClose={onClose}
      footer={
        <>
          {existing && onRemove && (
            <Button variant="ghost" onClick={onRemove}>
              {t("dashboard.config.remove")}
            </Button>
          )}
          <Button onClick={onClose}>{t("dashboard.config.cancel")}</Button>
          <Button variant="primary" disabled={blocked || busy} onClick={() => void submit()}>
            {existing ? t("dashboard.config.save") : t("dashboard.config.add")}
          </Button>
        </>
      }
    >
      <div className="dash-config">
        <div className="dash-config-form">
          <Field label={t("dashboard.config.title")}>
            <Input value={instance.title} maxLength={80} onChange={(e) => setInstance({ ...instance, title: e.target.value })} />
          </Field>
          <div className="dash-sizes" role="group" aria-label={t("dashboard.config.size")}>
            {SIZES.map((size) => (
              <Button key={size} size="sm" variant={instance.size === size ? "primary" : "secondary"} aria-pressed={instance.size === size} onClick={() => setInstance({ ...instance, size })}>
                {size.toUpperCase()}
              </Button>
            ))}
          </div>
          <WidgetSettingsFields
            plugin={plugin}
            instance={instance}
            onChange={setInstance}
            onSecret={(field, value) => setSecrets((s) => ({ ...s, [field]: value }))}
            onSecretTyping={(field, value) => setTyping((s) => ({ ...s, [field]: value }))}
            savedSecrets={saved}
          />
          {needsSecret && !canStore && <p className="error">{t("dashboard.config.noEncryption")}</p>}
          {missing.fields.length > 0 && <p className="muted dash-hint">{t("dashboard.config.missing", { fields: missing.fields.join(", ") })}</p>}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="dash-config-preview">
          <span className="muted">{t("dashboard.preview.label")}</span>
          <div className={`dash-preview-box dash-size-${instance.size}`}>
            <WidgetPreview
              plugin={plugin}
              version={version}
              draft={{ instance: { ...instance, instanceId: draftId }, secrets, secretsFrom: initial.instanceId }}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
