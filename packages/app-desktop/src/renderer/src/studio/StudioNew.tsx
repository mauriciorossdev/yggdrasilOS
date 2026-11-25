import { useMemo, useState } from "react";
import type { PluginPermission, PluginRecord, PluginScope, PluginView } from "../types.js";
import { StudioStage } from "./StudioStage.js";
import { STUDIO_TEMPLATES, slugify, suggestName, uniqueId, type StudioTemplate } from "./studioTemplates.js";
import { studioInitialPrompt, type StudioTerminalHarness } from "./studioContext.js";
import { isCliVisible } from "../onboarding/harnessFilter.js";
import { useOnboarding } from "../onboarding/store.js";
import { useI18n, type MessageKey } from "../i18n/index.js";

type Props = {
  plugins: PluginRecord[];
  onCancel: () => void;
  /** The draft exists on disk; the workspace opens with `initialPrompt` as the agent's first message. */
  onCreated: (record: PluginRecord, launch: { initialPrompt: string; harness: StudioTerminalHarness }) => void;
};

const VIEW_LABELS: Record<PluginView, MessageKey> = {
  tab: "studio.create.viewTab",
  panel: "studio.create.viewPanel",
  mobile: "studio.create.viewMobile",
};

const PERMISSION_LABELS: Record<string, MessageKey> = {
  fs: "studio.perm.fs",
  "fs:write": "studio.perm.fsWrite",
  panes: "studio.perm.panes",
};

const EMPTY_SAMPLE = `<style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;color:#a19f98;background:#1a1918;font-size:13px}</style>`;

/**
 * "Nuevo complemento": describe it, optionally pick a template, and the
 * agent builds it. Name, views and permissions are inferred (template, or
 * the description) and shown as editable chips; everything stays editable
 * later in Ajustes. Replaces the old field-by-field StudioCreateForm.
 */
export function StudioNew({ plugins, onCancel, onCreated }: Props) {
  const { t } = useI18n();
  const { settings: onboardingSettings } = useOnboarding();
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<StudioTemplate | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [scope, setScope] = useState<PluginScope>("project");
  const [views, setViews] = useState<PluginView[]>(["tab"]);
  const [permissions, setPermissions] = useState<PluginPermission[]>([]);
  const [previewView, setPreviewView] = useState<PluginView>("tab");
  const [harness, setHarness] = useState<StudioTerminalHarness>(
    isCliVisible("claude", onboardingSettings) || !isCliVisible("antigravity", onboardingSettings) ? "claude" : "agy",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templateName = template ? t(template.nameKey) : "";
  const effectiveName = nameTouched ? name : suggestName(description) || templateName;

  const pickTemplate = (tpl: StudioTemplate) => {
    const next = template?.id === tpl.id ? null : tpl;
    setTemplate(next);
    if (next) {
      setViews(scope === "global" ? next.views.filter((v) => v !== "mobile") : next.views);
      setPermissions(next.permissions);
      setPreviewView(next.views[0] ?? "tab");
    }
  };

  const toggleView = (v: PluginView) => setViews((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  const removePermission = (p: PluginPermission) => setPermissions((prev) => prev.filter((x) => x !== p));

  const takenIds = useMemo(
    () => new Set(plugins.filter((p) => p.scope === scope).map((p) => p.manifest.id)),
    [plugins, scope],
  );

  const create = async () => {
    setError(null);
    const finalName = effectiveName.trim();
    if (!description.trim() && !template) {
      setError(t("studio.new.errDescribe"));
      return;
    }
    if (!finalName) {
      setError(t("studio.create.errName"));
      return;
    }
    const finalViews = views.length > 0 ? views : ["tab" as PluginView];
    setBusy(true);
    try {
      const record = await window.yggdrasil.plugins.scaffold({
        id: uniqueId(slugify(finalName), takenIds),
        name: finalName,
        scope,
        views: finalViews,
        permissions,
        description: description.trim() || (template ? t(template.descKey) : undefined),
      });
      onCreated(record, {
        initialPrompt: studioInitialPrompt(description.trim() || t(template!.descKey), template?.agentHint),
        harness,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const sample = template ? template.sampleHtml : `${EMPTY_SAMPLE}<p>${t("studio.new.sampleEmpty")}</p>`;

  return (
    <div className="studio-new">
      <section className="studio-new-form">
        <div>
          <h2 className="studio-new-title">{t("studio.new.title")}</h2>
          <p className="muted studio-new-sub">{t("studio.new.subtitle")}</p>
        </div>
        <div className="studio-new-prompt">
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("studio.new.placeholder")}
            aria-label={t("studio.new.describe")}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void create();
              }
            }}
          />
          <div className="studio-new-prompt-bar">
            <select
              className="studio-harness-select"
              value={harness}
              onChange={(e) => setHarness(e.target.value as StudioTerminalHarness)}
              title={t("studio.workspace.harnessTitle")}
            >
              {(harness === "claude" || isCliVisible("claude", onboardingSettings)) && <option value="claude">claude</option>}
              {(harness === "agy" || isCliVisible("antigravity", onboardingSettings)) && <option value="agy">agy (Antigravity)</option>}
            </select>
            <span className="studio-spacer" />
            <button type="button" className="studio-ghost-btn" onClick={onCancel} disabled={busy}>
              {t("ui.cancel")}
            </button>
            <button type="button" className="studio-primary-btn" onClick={() => void create()} disabled={busy}>
              {busy ? t("studio.create.submitting") : t("studio.new.create")}
            </button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="studio-new-section">
          <span className="muted studio-new-label">{t("studio.new.templates")}</span>
          <div className="studio-templates">
            {STUDIO_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className={`studio-template${template?.id === tpl.id ? " on" : ""}`}
                aria-pressed={template?.id === tpl.id}
                onClick={() => pickTemplate(tpl)}
              >
                <strong>{t(tpl.nameKey)}</strong>
                <span className="muted">{t(tpl.descKey)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="studio-new-section studio-new-config">
          <span className="muted studio-new-label">{t("studio.new.willConfigure")}</span>
          <div className="studio-new-chips">
            <label className="studio-new-name">
              <span className="muted">{t("studio.create.name")}</span>
              <input
                value={effectiveName}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                placeholder={t("studio.create.namePlaceholder")}
              />
            </label>
            <button
              type="button"
              className={`studio-chip-btn${scope === "project" ? " on" : ""}`}
              aria-pressed={scope === "project"}
              onClick={() => setScope("project")}
            >
              {t("studio.create.scopeProject")}
            </button>
            <button
              type="button"
              className={`studio-chip-btn${scope === "global" ? " on" : ""}`}
              aria-pressed={scope === "global"}
              onClick={() => {
                setScope("global");
                setViews((prev) => prev.filter((v) => v !== "mobile"));
              }}
            >
              {t("studio.create.scopeGlobal")}
            </button>
            <span className="studio-chip-sep" aria-hidden="true" />
            {(["tab", "panel", "mobile"] as PluginView[]).map((v) => {
              const blocked = v === "mobile" && scope === "global";
              return (
                <button
                  key={v}
                  type="button"
                  className={`studio-chip-btn${views.includes(v) ? " on" : ""}`}
                  aria-pressed={views.includes(v)}
                  disabled={blocked}
                  title={blocked ? t("studio.create.mobileUnavailable") : undefined}
                  onClick={() => toggleView(v)}
                >
                  {t(VIEW_LABELS[v])}
                </button>
              );
            })}
            {permissions.length > 0 && <span className="studio-chip-sep" aria-hidden="true" />}
            {permissions.map((p) => (
              <span key={p} className="studio-chip-btn on studio-chip-perm">
                {PERMISSION_LABELS[p] ? t(PERMISSION_LABELS[p]) : <span className="mono">{p}</span>}
                <button type="button" aria-label={t("studio.perm.remove", { name: p })} onClick={() => removePermission(p)}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <span className="muted studio-new-hint">{t("studio.new.laterInSettings")}</span>
        </div>
      </section>
      <section className="studio-new-preview">
        <div className="studio-toolbar studio-new-preview-bar">
          <span className="muted">
            {template ? t("studio.new.sampleOf", { name: t(template.nameKey) }) : t("studio.new.sample")}
          </span>
          <span className="studio-spacer" />
          <div className="studio-seg" role="tablist" aria-label={t("studio.preview.as")}>
            {(["tab", "panel", "mobile"] as PluginView[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={previewView === v}
                className={previewView === v ? "active" : ""}
                onClick={() => setPreviewView(v)}
              >
                {t(VIEW_LABELS[v])}
              </button>
            ))}
          </div>
        </div>
        <div className="studio-new-stage">
          <StudioStage view={previewView}>
            {/* Static illustration only. No allow-scripts, so nothing in it can run;
                allow-same-origin is required anyway — with a fully empty sandbox
                Chromium renders this srcdoc blank inside the app window. */}
            <iframe className="plugin-frame" sandbox="allow-same-origin" srcDoc={sample} title={t("studio.new.sample")} />
          </StudioStage>
          <p className="muted studio-new-sample-note">{t("studio.new.sampleNote")}</p>
        </div>
      </section>
    </div>
  );
}
