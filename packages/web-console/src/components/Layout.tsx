import { Suspense, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useGateway } from "@yggdrasil/client-web";
import { LANGUAGES, PRESETS, useI18n } from "@yggdrasil/ui-kit";
import { applyPreset, LIGHT_ID, savedPresetId } from "../theme";
import { chooseLanguage, useT } from "../i18n";

export function Layout() {
  const { health, disconnect } = useGateway();
  const { t, language } = useI18n();
  const tc = useT();
  const [presetId, setPresetId] = useState(savedPresetId);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">🌳</span>
          <div>
            <strong>Yggdrasil</strong>
            <small>v{health?.version ?? "—"}</small>
          </div>
        </div>
        <nav>
          <NavLink to="/" end>
            {tc("nav.overview")}
          </NavLink>
          <NavLink to="/chat">{tc("nav.chat")}</NavLink>
          <NavLink to="/sessions">{tc("nav.sessions")}</NavLink>
          <NavLink to="/documents">{tc("nav.documents")}</NavLink>
          <NavLink to="/memory">{tc("nav.memory")}</NavLink>
          <NavLink to="/workflows">{tc("nav.workflows")}</NavLink>
          <NavLink to="/repository">{tc("nav.repository")}</NavLink>
          <NavLink to="/files">{tc("nav.files")}</NavLink>
          <NavLink to="/terminals">{tc("nav.terminals")}</NavLink>
          <NavLink to="/providers">{tc("nav.providers")}</NavLink>
          <NavLink to="/agents">{tc("nav.agents")}</NavLink>
          <NavLink to="/mcp">{tc("nav.mcp")}</NavLink>
          <NavLink to="/settings">{tc("nav.settings")}</NavLink>
        </nav>
        <div className="sidebar-footer">
          <select
            className="theme-select"
            aria-label={tc("nav.theme")}
            value={presetId}
            onChange={(e) => {
              setPresetId(e.target.value);
              applyPreset(e.target.value);
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {t(p.name)}
              </option>
            ))}
            <option value={LIGHT_ID}>{tc("theme.light")}</option>
          </select>
          <select
            className="theme-select"
            aria-label={tc("nav.language")}
            value={language}
            onChange={(e) => chooseLanguage(e.target.value as (typeof LANGUAGES)[number]["id"])}
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <button type="button" className="link-btn" onClick={disconnect}>
            {tc("nav.disconnect")}
          </button>
        </div>
      </aside>
      <main className="main">
        <Suspense fallback={<p className="muted page">{tc("common.loading")}</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
