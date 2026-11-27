import { useState } from "react";
import type { PluginRecord, WidgetInstance } from "../types.js";
import { useI18n } from "../i18n/index.js";
import { Field, Input, Select } from "../ui/index.js";
import { netDomainsOf, queriesPerDay, refreshChoices } from "./dashboardLogic.js";
import { refreshLabel } from "./format.js";

type Props = {
  plugin: PluginRecord;
  instance: WidgetInstance;
  onChange: (instance: WidgetInstance) => void;
  /** Applied when the field loses focus, so a half-typed key never reaches the API. */
  onSecret: (field: string, value: string) => void;
  /** Every keystroke, for enabling Save; never sent anywhere from here. */
  onSecretTyping?: (field: string, value: string) => void;
  /** field -> host of the secrets already stored. */
  savedSecrets: Record<string, string>;
};

/** The form the app draws from a widget's configSchema, plus interval and domain permission. */
export function WidgetSettingsFields({ plugin, instance, onChange, onSecret, onSecretTyping, savedSecrets }: Props) {
  const { t } = useI18n();
  const spec = plugin.manifest.widget!;
  const domains = netDomainsOf(plugin);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const set = (key: string, value: unknown) => onChange({ ...instance, config: { ...instance.config, [key]: value } });

  return (
    <>
      {spec.fields.map((f) => {
        const value = instance.config[f.key];
        return (
          <div key={f.key} className="dash-form-field">
            {f.type === "bool" ? (
              <label className="dash-check">
                <input type="checkbox" checked={value === true} onChange={(e) => set(f.key, e.target.checked)} />
                {f.title}
              </label>
            ) : (
              <Field label={f.title}>
                {f.type === "list" ? (
                  <Select value={String(value ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : f.type === "secret" ? (
                  <Input
                    type="password"
                    autoComplete="off"
                    value={typed[f.key] ?? ""}
                    placeholder={savedSecrets[f.key] === f.domain ? t("dashboard.config.secretSaved") : ""}
                    onChange={(e) => {
                      setTyped((s) => ({ ...s, [f.key]: e.target.value }));
                      onSecretTyping?.(f.key, e.target.value.trim());
                    }}
                    onBlur={() => onSecret(f.key, (typed[f.key] ?? "").trim())}
                  />
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : "text"}
                    value={String(value ?? "")}
                    onChange={(e) => set(f.key, f.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)}
                  />
                )}
              </Field>
            )}
            {f.description && <span className="muted dash-hint">{f.description}</span>}
            {f.type === "secret" && <span className="muted dash-hint">{t("dashboard.config.secretHint", { domain: f.domain ?? "" })}</span>}
          </div>
        );
      })}
      {domains.length > 0 && (
        <>
          <div className="dash-form-field">
            <Field label={t("dashboard.config.refresh")}>
              <Select value={String(instance.refreshSeconds)} onChange={(e) => onChange({ ...instance, refreshSeconds: Number(e.target.value) })}>
                {refreshChoices(spec).map((s) => (
                  <option key={s} value={s}>
                    {refreshLabel(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <span className="muted dash-hint">
              {instance.refreshSeconds > 0
                ? t("dashboard.config.perDay", { count: queriesPerDay(instance.refreshSeconds) })
                : t("dashboard.config.manualHint")}
            </span>
          </div>
          <fieldset className="dash-permission">
            <legend>{t("dashboard.config.permission")}</legend>
            {domains.map((domain) => (
              <label key={domain} className="dash-check">
                <input
                  type="checkbox"
                  checked={instance.grantedDomains.includes(domain)}
                  onChange={(e) =>
                    onChange({
                      ...instance,
                      grantedDomains: e.target.checked
                        ? [...instance.grantedDomains, domain]
                        : instance.grantedDomains.filter((d) => d !== domain),
                    })
                  }
                />
                <span>
                  {t("dashboard.config.allow")} <code>{domain}</code>
                </span>
              </label>
            ))}
          </fieldset>
        </>
      )}
    </>
  );
}
