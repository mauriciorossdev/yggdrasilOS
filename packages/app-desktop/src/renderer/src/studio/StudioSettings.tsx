import { useEffect, useMemo, useState } from "react";
import type { PermissionLint, PluginPermission, PluginRecord, PluginView } from "../types.js";
import type { MessageKey } from "../i18n/index.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  plugin: PluginRecord;
  lint: PermissionLint | null;
  /** After a successful save — the workspace reloads the preview and re-lints. */
  onSaved: () => void;
};

const VIEW_LABELS: Record<PluginView, MessageKey> = {
  tab: "studio.create.viewTab",
  panel: "studio.create.viewPanel",
  mobile: "studio.create.viewMobile", widget: "studio.create.viewWidget",
};

/** The fixed permissions, in plain language first, technical id second. */
const BASE_PERMISSIONS: { id: PluginPermission; label: MessageKey; hint: MessageKey }[] = [
  { id: "fs", label: "studio.perm.fs", hint: "studio.perm.fsHint" },
  { id: "fs:write", label: "studio.perm.fsWrite", hint: "studio.perm.fsWriteHint" },
  { id: "panes", label: "studio.perm.panes", hint: "studio.perm.panesHint" },
];

type Draft = {
  name: string;
  icon: string;
  views: PluginView[];
  permissions: PluginPermission[];
  description: string;
};

function draftOf(plugin: PluginRecord): Draft {
  const m = plugin.manifest;
  return {
    name: m.name,
    icon: m.icon ?? "",
    views: [...(m.views ?? [])],
    permissions: [...(m.permissions ?? [])],
    description: m.description ?? "",
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.name === b.name &&
    a.icon === b.icon &&
    a.description === b.description &&
    a.views.join() === b.views.join() &&
    [...a.permissions].sort().join() === [...b.permissions].sort().join()
  );
}

/**
 * Ajustes tab: the manifest, editable. Scope is read-only (changing it means
 * moving the folder). Each permission shows where the code uses it, and a
 * permission the code uses without declaring it is flagged — those calls
 * fail at runtime. Saves through plugins:updateManifest.
 */
export function StudioSettings({ plugin, lint, onSaved }: Props) {
  const { t } = useI18n();
  const saved = useMemo(() => draftOf(plugin), [plugin]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [gatewayInput, setGatewayInput] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = !sameDraft(draft, saved);

  // A save (or an agent editing manifest.json) lands as a new record: adopt
  // it unless the user is mid-edit.
  useEffect(() => {
    if (!dirty) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const usesOf = (perm: string) => lint?.uses.find((u) => u.permission === perm);
  const missing = new Set(lint?.missing ?? []);
  const gatewayPerms = [
    ...new Set([...draft.permissions.filter((p) => p.startsWith("gateway:")), ...[...missing].filter((p) => p.startsWith("gateway:"))]),
  ];

  const netPerms = [
    ...new Set([...draft.permissions.filter((p) => p.startsWith("net:")), ...[...missing].filter((p) => p.startsWith("net:"))]),
  ];
  // Shown where it can matter: a widget, or code or a manifest that already goes online.
  const showNet = draft.views.includes("widget") || netPerms.length > 0 || missing.has("net");

  const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const setPerm = (perm: string, on: boolean) =>
    setDraft((d) => ({
      ...d,
      permissions: on ? [...new Set([...d.permissions, perm])] : d.permissions.filter((p) => p !== perm),
    }));
  const addGateway = () => {
    const method = gatewayInput.trim().replace(/^gateway:/, "");
    if (!method) return;
    setPerm(`gateway:${method}`, true);
    setGatewayInput("");
  };

  const addDomain = () => {
    const host = domainInput
      .trim()
      .toLowerCase()
      .replace(/^net:/, "")
      .replace(/^https?:\/\//, "")
      .split("/")[0];
    if (!host) return;
    setPerm(`net:${host}`, true);
    setDomainInput("");
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.yggdrasil.plugins.updateManifest(plugin.scope, plugin.manifest.id, {
        name: draft.name,
        icon: draft.icon || null,
        views: draft.views,
        permissions: draft.permissions,
        description: draft.description || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const usage = (perm: string) => {
    const use = usesOf(perm);
    const declared = draft.permissions.includes(perm);
    if (use && !declared) {
      return <span className="studio-perm-warn">{t("studio.perm.missing", { where: `${use.file}:${use.line}` })}</span>;
    }
    if (use) return <span className="muted">{t("studio.perm.usedBy", { where: `${use.file}:${use.line}` })}</span>;
    return null;
  };

  return (
    <div className="studio-settings">
      {error && <p className="error">{error}</p>}
      <div className="studio-set-row">
        <span className="studio-set-label">{t("studio.settings.nameIcon")}</span>
        <div className="studio-set-field studio-set-inline">
          <input
            className="studio-set-icon"
            value={draft.icon}
            onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))}
            placeholder="🧩"
            aria-label={t("studio.create.icon")}
          />
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            aria-label={t("studio.create.name")}
          />
        </div>
      </div>
      <div className="studio-set-row">
        <span className="studio-set-label">{t("studio.settings.scope")}</span>
        <div className="studio-set-field">
          <span>{plugin.scope === "global" ? t("studio.create.scopeGlobal") : t("studio.create.scopeProject")}</span>
          <span className="muted mono studio-set-path">
            {plugin.scope === "global" ? plugin.dir : `.yggdrasil/plugins/${plugin.manifest.id}/`}
          </span>
        </div>
      </div>
      <div className="studio-set-row">
        <span className="studio-set-label">{t("studio.create.views")}</span>
        <div className="studio-set-field studio-set-inline">
          {(["tab", "panel", "mobile", "widget"] as PluginView[]).map((v) => {
            const blocked = v === "mobile" ? plugin.scope === "global" : v === "widget" && plugin.scope === "project";
            return (
              <button
                key={v}
                type="button"
                className={`studio-chip-btn${draft.views.includes(v) ? " on" : ""}`}
                aria-pressed={draft.views.includes(v)}
                disabled={blocked}
                title={blocked ? t(v === "widget" ? "dashboard.preview.globalOnly" : "studio.create.mobileUnavailable") : undefined}
                onClick={() => setDraft((d) => ({ ...d, views: toggle(d.views, v) }))}
              >
                {t(VIEW_LABELS[v])}
              </button>
            );
          })}
        </div>
      </div>
      <div className="studio-set-row">
        <span className="studio-set-label">{t("studio.settings.permissions")}</span>
        <div className="studio-set-field studio-perms">
          {BASE_PERMISSIONS.map((p) => (
            <label key={p.id} className="studio-perm">
              <input type="checkbox" checked={draft.permissions.includes(p.id)} onChange={(e) => setPerm(p.id, e.target.checked)} />
              <span>
                <strong>{t(p.label)}</strong> <span className="mono muted studio-perm-id">{p.id}</span>
                <br />
                <span className="muted">{t(p.hint)}</span>
                {usage(p.id) && (
                  <>
                    <br />
                    {usage(p.id)}
                  </>
                )}
              </span>
            </label>
          ))}
          <div className="studio-perm">
            <span className="studio-perm-spacer" />
            <span>
              <strong>{t("studio.perm.gateway")}</strong> <span className="mono muted studio-perm-id">gateway:*</span>
              <div className="studio-gw-chips">
                {gatewayPerms.map((p) => {
                  const declared = draft.permissions.includes(p);
                  return (
                    <span key={p} className={`studio-gw-chip mono${declared ? "" : " missing"}`}>
                      {p.slice("gateway:".length)}
                      {declared ? (
                        <button type="button" aria-label={t("studio.perm.remove", { name: p })} onClick={() => setPerm(p, false)}>
                          ×
                        </button>
                      ) : (
                        <button type="button" onClick={() => setPerm(p, true)}>
                          {t("studio.perm.add")}
                        </button>
                      )}
                    </span>
                  );
                })}
                <input
                  className="mono studio-gw-input"
                  value={gatewayInput}
                  onChange={(e) => setGatewayInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addGateway();
                    }
                  }}
                  placeholder={t("studio.create.gatewayPlaceholder")}
                  aria-label={t("studio.create.gatewayPlaceholder")}
                />
              </div>
              {gatewayPerms.filter((p) => !draft.permissions.includes(p)).map((p) => (
                <div key={p}>{usage(p)}</div>
              ))}
            </span>
          </div>
          {showNet && (
            <div className="studio-perm">
              <span className="studio-perm-spacer" />
              <span>
                <strong>{t("studio.perm.net")}</strong> <span className="mono muted studio-perm-id">net:*</span>
                <br />
                <span className="muted">{t("studio.perm.netHint")}</span>
                <div className="studio-gw-chips">
                  {netPerms.map((p) => {
                    const declared = draft.permissions.includes(p);
                    return (
                      <span key={p} className={`studio-gw-chip mono${declared ? "" : " missing"}`}>
                        {p.slice("net:".length)}
                        {declared ? (
                          <button type="button" aria-label={t("studio.perm.remove", { name: p })} onClick={() => setPerm(p, false)}>
                            ×
                          </button>
                        ) : (
                          <button type="button" onClick={() => setPerm(p, true)}>
                            {t("studio.perm.add")}
                          </button>
                        )}
                      </span>
                    );
                  })}
                  <input
                    className="mono studio-gw-input"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addDomain();
                      }
                    }}
                    onBlur={addDomain}
                    placeholder={t("studio.perm.netPlaceholder")}
                    aria-label={t("studio.perm.netPlaceholder")}
                  />
                </div>
                {netPerms.filter((p) => !draft.permissions.includes(p)).map((p) => (
                  <div key={p}>{usage(p)}</div>
                ))}
                {/* A call whose host can't be read from the code, with no domain declared at all. */}
                {missing.has("net") && !draft.permissions.some((p) => p.startsWith("net:")) && <div>{usage("net")}</div>}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="studio-set-row">
        <span className="studio-set-label">{t("studio.settings.description")}</span>
        <div className="studio-set-field">
          <textarea
            rows={2}
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            aria-label={t("studio.settings.description")}
          />
        </div>
      </div>
      <div className="studio-set-actions">
        <span className="muted">{t("studio.settings.saveHint")}</span>
        <span className="studio-spacer" />
        <button type="button" className="studio-ghost-btn" disabled={!dirty || busy} onClick={() => setDraft(saved)}>
          {t("studio.settings.discard")}
        </button>
        <button type="button" className="studio-primary-btn" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? t("studio.settings.saving") : t("studio.settings.save")}
        </button>
      </div>
    </div>
  );
}
