import { useEffect, useState } from "react";
import { updateEditorPrefs, useEditorPrefs } from "../../files/editorPrefs.js";
import { fetchLspStatus, type LspStatus } from "../../files/lsp/service.js";
import { useI18n, type MessageKey } from "../../i18n/index.js";

const TAB_SIZES = [2, 4, 8];

const STATUS_LABEL: Record<LspStatus["servers"][number]["status"], MessageKey> = {
  running: "set.editor.lsp.running",
  available: "set.editor.lsp.available",
  missing: "set.editor.lsp.missing",
  needsTrust: "set.editor.lsp.needsTrust",
  notApplicable: "set.editor.lsp.notApplicable",
};

/** Code editor preferences. Like Appearance, these apply right away and aren't part of "Save settings". */
export function EditorSection() {
  const { t } = useI18n();
  const prefs = useEditorPrefs();
  const [lsp, setLsp] = useState<LspStatus | null>(null);
  const inProject = Boolean(window.yggdrasil.projectPath);
  useEffect(() => {
    if (inProject) void fetchLspStatus().then(setLsp);
  }, [inProject]);
  return (
    <section className="settings-section">
      <h3>{t("set.editor.title")}</h3>
      <p className="muted">{t("set.editor.intro")}</p>
      <label>
        {t("set.editor.fontSize")}
        <input
          type="number"
          min={8}
          max={32}
          value={prefs.fontSize}
          onChange={(e) => {
            const size = Number(e.target.value);
            if (size >= 8 && size <= 32) updateEditorPrefs({ fontSize: size });
          }}
        />
      </label>
      <label>
        {t("set.editor.tabSize")}
        <select value={prefs.tabSize} onChange={(e) => updateEditorPrefs({ tabSize: Number(e.target.value) })}>
          {TAB_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">{t("set.editor.tabSizeHelp")}</p>
      <label className="settings-check">
        <input type="checkbox" checked={prefs.wordWrap} onChange={(e) => updateEditorPrefs({ wordWrap: e.target.checked })} />
        {t("set.editor.wordWrap")}
      </label>
      <label className="settings-check">
        <input type="checkbox" checked={prefs.minimap} onChange={(e) => updateEditorPrefs({ minimap: e.target.checked })} />
        {t("set.editor.minimap")}
      </label>
      <label className="settings-check">
        <input type="checkbox" checked={prefs.formatOnSave} onChange={(e) => updateEditorPrefs({ formatOnSave: e.target.checked })} />
        {t("set.editor.formatOnSave")}
      </label>
      <p className="muted">{t("set.editor.formatOnSaveHelp")}</p>
      <label className="settings-check">
        <input type="checkbox" checked={prefs.fixOnSave} onChange={(e) => updateEditorPrefs({ fixOnSave: e.target.checked })} />
        {t("set.editor.fixOnSave")}
      </label>
      {lsp && (
        <>
          <h3>{t("set.editor.lsp.title")}</h3>
          <p className="muted">{t("set.editor.lsp.intro")}</p>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={lsp.trusted}
              onChange={(e) => {
                const trusted = e.target.checked;
                void window.yggdrasil.lsp.setTrusted(trusted).then(() => fetchLspStatus().then(setLsp));
              }}
            />
            {t("set.editor.lsp.trust")}
          </label>
          <p className="muted">{t("set.editor.lsp.trustHelp")}</p>
          {lsp.servers
            .filter((s) => s.status !== "notApplicable")
            .map((s) => (
              <div key={s.id} className="lsp-trust-row">
                <code>{s.id}</code>
                <span>{s.error ? t("set.editor.lsp.failed") : t(STATUS_LABEL[s.status])}</span>
                {(s.status === "missing" || s.error) && s.installHint && <code className="muted">{s.installHint}</code>}
                {s.error && <span className="muted lsp-trust-error" title={s.error}>{s.error}</span>}
              </div>
            ))}
        </>
      )}
    </section>
  );
}
