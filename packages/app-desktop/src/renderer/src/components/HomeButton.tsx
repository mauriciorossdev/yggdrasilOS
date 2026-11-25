import { useEffect, useRef, useState } from "react";
import { HomeIcon } from "@heroicons/react/20/solid";
import { useI18n } from "../i18n/index.js";
import type { ProjectRecord } from "../types.js";

const OPEN_DELAY_MS = 150;
// Long enough to cross the small gap between the button and the popover.
const CLOSE_DELAY_MS = 200;

/**
 * Title-bar Home button. Click → main (Home) window, as before; hovering it
 * floats a popover with Home's project list (most recently opened first, same
 * order as projects.list()) so you can jump straight to another project.
 */
export function HomeButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const timer = useRef(0);

  const schedule = (next: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), next ? OPEN_DELAY_MS : CLOSE_DELAY_MS);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Refetch on every open: projects can be added/renamed from any window.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void window.yggdrasil.projects
      .list()
      .then((list) => alive && setProjects(list))
      .catch(() => alive && setProjects([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(
    () =>
      window.yggdrasil.projects.onColorChange((id, color) =>
        setProjects((prev) => prev?.map((p) => (p.id === id ? { ...p, color } : p)) ?? prev),
      ),
    [],
  );

  const currentId = window.yggdrasil.projectId;

  return (
    <div className="title-bar-home" onMouseEnter={() => schedule(true)} onMouseLeave={() => schedule(false)}>
      <button
        type="button"
        className="title-bar-btn"
        aria-label={t("title.home")}
        aria-haspopup="menu"
        aria-expanded={open}
        onFocus={() => schedule(true)}
        onBlur={() => schedule(false)}
        onClick={() => {
          setOpen(false);
          void window.yggdrasil.projects.openHome();
        }}
      >
        <HomeIcon className="hero-icon" />
      </button>
      {open && (
        <div className="title-bar-home-popover" role="menu" onFocus={() => schedule(true)} onBlur={() => schedule(false)}>
          <div className="title-bar-home-header">
            <span>{t("title.homeProjects")}</span>
            {projects && <span className="title-bar-home-count">{projects.length}</span>}
          </div>
          {projects === null ? (
            <div className="title-bar-home-empty">{t("ui.loading")}</div>
          ) : projects.length === 0 ? (
            <div className="title-bar-home-empty">{t("title.homeEmpty")}</div>
          ) : (
            <div className="title-bar-home-list">
              {projects.map((p) => {
                const current = p.id === currentId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    className={`title-bar-home-item${current ? " current" : ""}`}
                    title={p.path}
                    onClick={() => {
                      setOpen(false);
                      void window.yggdrasil.projects.open(p.id);
                    }}
                  >
                    <span className="title-bar-home-dot" style={p.color ? { background: p.color } : undefined} />
                    <span className="title-bar-home-text">
                      <span className="title-bar-home-name">{p.name}</span>
                      {/* LRM marks keep the slashes in place under the path's direction:rtl (start-side ellipsis). */}
                      <span className="title-bar-home-path">{`\u200E${p.path}\u200E`}</span>
                    </span>
                    {current && <span className="title-bar-home-badge">{t("title.homeCurrent")}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className="title-bar-home-footer"
            onClick={() => {
              setOpen(false);
              void window.yggdrasil.projects.openHome();
            }}
          >
            <HomeIcon className="hero-icon" />
            {t("title.home")}
          </button>
        </div>
      )}
    </div>
  );
}
