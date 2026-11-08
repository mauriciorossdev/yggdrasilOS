import { useState } from "react";
import type { PluginPermission, PluginRecord, PluginScope, PluginView, ScaffoldPluginSpec } from "../types.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  onCancel: () => void;
  onCreated: (record: PluginRecord) => void;
};

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "complemento";
}

/** "+ Nuevo" in StudioView — describes a complemento and creates it (as a draft) via `plugins:scaffold`. No file editing happens here; that's StudioWorkspace's job once the draft exists. */
export function StudioCreateForm({ onCancel, onCreated }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [icon, setIcon] = useState("");
  const [scope, setScope] = useState<PluginScope>("project");
  const [views, setViews] = useState<PluginView[]>(["tab"]);
  const [permissions, setPermissions] = useState<PluginPermission[]>([]);
  const [gatewayMethod, setGatewayMethod] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The id field tracks the name's slug until the user edits it directly —
  // same "derived until touched" pattern as most slug-from-title forms.
  const effectiveId = idTouched ? id : slugify(name);

  const toggleView = (v: PluginView) => {
    setViews((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  };
  const togglePermission = (p: PluginPermission) => {
    setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };
  const addGatewayPermission = () => {
    const method = gatewayMethod.trim();
    if (!method) return;
    const perm = `gateway:${method}`;
    setPermissions((prev) => (prev.includes(perm) ? prev : [...prev, perm]));
    setGatewayMethod("");
  };
  const removePermission = (p: PluginPermission) => setPermissions((prev) => prev.filter((x) => x !== p));
  const gatewayPermissions = permissions.filter((p) => p.startsWith("gateway:"));

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError(t("studio.create.errName"));
      return;
    }
    if (!PLUGIN_ID_RE.test(effectiveId)) {
      setError(t("studio.create.errId"));
      return;
    }
    if (views.length === 0) {
      setError(t("studio.create.errViews"));
      return;
    }
    const spec: ScaffoldPluginSpec = {
      id: effectiveId,
      name: name.trim(),
      icon: icon.trim() || undefined,
      scope,
      views,
      permissions,
      description: description.trim() || undefined,
    };
    setSubmitting(true);
    try {
      const record = await window.yggdrasil.plugins.scaffold(spec);
      onCreated(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="studio-create-form">
      <h3 className="agent-form-title">{t("studio.create.title")}</h3>
      <div className="agent-form">
        {error && <p className="error">{error}</p>}
        <label>
          {t("studio.create.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("studio.create.namePlaceholder")} autoFocus />
        </label>
        <label>
          {t("studio.create.id")}
          <input
            value={effectiveId}
            onChange={(e) => {
              setId(e.target.value);
              setIdTouched(true);
            }}
          />
        </label>
        <label>
          {t("studio.create.icon")}
          <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="📋" />
        </label>
        <label>
          {t("studio.create.scope")}
          <div className="scope-choice">
            <label>
              <input type="radio" checked={scope === "project"} onChange={() => setScope("project")} /> {t("studio.create.scopeProject")}
            </label>
            <label>
              <input
                type="radio"
                checked={scope === "global"}
                onChange={() => {
                  setScope("global");
                  // Mobile only ever lists a project's own .yggdrasil/plugins —
                  // a global (userData) complemento is invisible to it.
                  setViews((prev) => prev.filter((v) => v !== "mobile"));
                }}
              />{" "}
              {t("studio.create.scopeGlobal")}
            </label>
          </div>
        </label>
        <label>
          {t("studio.create.views")}
          <div className="scope-choice">
            <label>
              <input type="checkbox" checked={views.includes("tab")} onChange={() => toggleView("tab")} /> {t("studio.create.viewTab")}
            </label>
            <label>
              <input type="checkbox" checked={views.includes("panel")} onChange={() => toggleView("panel")} /> {t("studio.create.viewPanel")}
            </label>
            <label title={scope === "global" ? t("studio.create.mobileUnavailable") : undefined}>
              <input
                type="checkbox"
                checked={views.includes("mobile")}
                disabled={scope === "global"}
                onChange={() => toggleView("mobile")}
              />{" "}
              {t("studio.create.viewMobile")}
            </label>
          </div>
        </label>
        <label>
          {t("studio.create.permissions")}
          <div className="scope-choice">
            <label>
              <input type="checkbox" checked={permissions.includes("fs")} onChange={() => togglePermission("fs")} /> fs
            </label>
            <label>
              <input
                type="checkbox"
                checked={permissions.includes("fs:write")}
                onChange={() => togglePermission("fs:write")}
              />{" "}
              fs:write
            </label>
            <label>
              <input
                type="checkbox"
                checked={permissions.includes("panes")}
                onChange={() => togglePermission("panes")}
              />{" "}
              panes
            </label>
          </div>
          <div className="studio-permission-add">
            <input
              value={gatewayMethod}
              onChange={(e) => setGatewayMethod(e.target.value)}
              placeholder={t("studio.create.gatewayPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addGatewayPermission();
                }
              }}
            />
            <button type="button" onClick={addGatewayPermission}>
              {t("studio.create.add")}
            </button>
          </div>
          {gatewayPermissions.length > 0 && (
            <div className="studio-permission-chips">
              {gatewayPermissions.map((p) => (
                <span key={p} className="studio-chip">
                  {p}
                  <button type="button" onClick={() => removePermission(p)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </label>
        <label>
          {t("studio.create.description")}
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
        <div className="agent-form-actions">
          <button type="button" onClick={onCancel} disabled={submitting}>
            {t("ui.cancel")}
          </button>
          <button type="submit" onClick={() => void submit()} disabled={submitting}>
            {submitting ? t("studio.create.submitting") : t("studio.create.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
