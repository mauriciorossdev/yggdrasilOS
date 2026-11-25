import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { StudioChatPane } from "./StudioChatPane.js";
import { StudioFiles } from "./StudioFiles.js";
import { StudioPreview, type StudioPreviewStatus } from "./StudioPreview.js";
import { StudioSettings } from "./StudioSettings.js";
import { StudioTerminalPane, type StudioAgentHandle } from "./StudioTerminalPane.js";
import { pluginGlyph, studioFixRequest, type StudioTerminalHarness } from "./studioContext.js";
import { usePermissionLint, usePluginChanges, usePluginFiles } from "./studioHooks.js";
import type { PluginFileEntry, PluginRecord, PluginView } from "../types.js";
import type { PluginErrorEntry } from "../plugins/pluginTypes.js";
import { isCliVisible } from "../onboarding/harnessFilter.js";
import { useOnboarding } from "../onboarding/store.js";
import { useI18n } from "../i18n/index.js";

type AuthoringMode = "terminal" | "chat";
type WorkspaceTab = "agent" | "files" | "settings";

type Props = {
  plugin: PluginRecord;
  projectPath: string;
  /** Set when the complemento was just created from a description: the agent starts with that as its first message. One-shot — see onLaunchConsumed. */
  launch?: { initialPrompt: string; harness: StudioTerminalHarness };
  /** Called once the launch was taken, so the owner drops it: a later remount (LRU eviction, reselect) must start a plain session, never re-send the build prompt. */
  onLaunchConsumed?: () => void;
  /** Fires right after a successful delete, before the folder-gone re-scan lands — lets StudioView clear its selection immediately instead of briefly pointing at a plugin that no longer exists on disk. */
  onDeleted: () => void;
  /** Opens a project-relative file in the app's viewer (ChatView's openFile). */
  onOpenFile?: (relativePath: string) => void;
};

const PREVIEW_WIDTH_KEY = "ygg.studio.previewWidth";
const MIN_PANE = 320;
/** .studio-divider width and .studio-workspace-body horizontal padding (styles.css). */
const DIVIDER_W = 14;
const BODY_PAD_X = 32;
const VIEWS: PluginView[] = ["tab", "panel", "mobile"];
const RECENT_SHOWN = 4;

function readPreviewWidth(): number | null {
  try {
    const n = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * One complemento's workbench:
 *  - header: identity, console summary, ⋯ menu;
 *  - toolbar: Agente / Archivos / Ajustes tabs, the agent's Terminal/Chat
 *    and CLI, "preview as" Tab/Panel/Mobile, Reload;
 *  - body: the active tab | resizable divider | live StudioPreview;
 *  - footer: Borrador → Probado → Publicado, what's blocking, Publicar.
 *
 * Terminal and Chat are mounted the first time they're used and from then on
 * only hidden, never unmounted — switching tabs or modes must not kill the
 * agent's session (StudioTerminalPane disposes its pty on unmount). The
 * preview reloads by itself whenever the plugin's files change on disk.
 */
export function StudioWorkspace({ plugin, projectPath, launch, onLaunchConsumed, onDeleted, onOpenFile }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("agent");
  const [mode, setMode] = useState<AuthoringMode>("terminal");
  const [mounted, setMounted] = useState<Record<AuthoringMode, boolean>>({ terminal: true, chat: false });
  const [harness, setHarness] = useState<StudioTerminalHarness>(launch?.harness ?? "claude");
  const [pendingHarness, setPendingHarness] = useState<StudioTerminalHarness | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const declaredViews = plugin.manifest.views ?? [];
  const [view, setView] = useState<PluginView>(declaredViews[0] ?? "tab");
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<StudioPreviewStatus>({ errors: 0, warns: 0, logs: 0, ready: false });
  const [previewWidth, setPreviewWidth] = useState<number | null>(readPreviewWidth);
  const [resizing, setResizing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<StudioAgentHandle>(null);
  const chatRef = useRef<StudioAgentHandle>(null);
  const { settings: onboardingSettings } = useOnboarding();
  const { files, openedAt } = usePluginFiles(plugin);
  const { lint, refresh: refreshLint } = usePermissionLint(plugin);
  const isDraft = plugin.manifest.status === "draft";
  const missingPerms = lint?.missing.length ?? 0;

  // The launch was captured by this mount's initial state (harness) and the
  // terminal's initialPromptRef; release it so no later mount replays it.
  const launchRef = useRef(launch);
  useEffect(() => {
    if (launchRef.current) onLaunchConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An agent editing the plugin's files reloads the preview by itself.
  usePluginChanges(plugin, () => setVersion((n) => n + 1));

  // A view the manifest stopped declaring (edited in Ajustes or by the agent) can't stay selected.
  useEffect(() => {
    if (declaredViews.length > 0 && !declaredViews.includes(view)) setView(declaredViews[0]);
  }, [declaredViews, view]);

  const switchMode = (next: AuthoringMode) => {
    setMode(next);
    setMounted((m) => (m[next] ? m : { ...m, [next]: true }));
  };

  const requestHarness = (next: StudioTerminalHarness) => {
    if (next === harness) return;
    // A live terminal would be respawned under the new CLI — ask first.
    if (mounted.terminal) setPendingHarness(next);
    else setHarness(next);
  };

  const askFix = (entry: PluginErrorEntry) => {
    setTab("agent");
    const text = studioFixRequest(entry.message, entry.stack);
    (mode === "terminal" ? terminalRef : chatRef).current?.send(text);
  };

  const openPluginFile = (file: PluginFileEntry) => {
    if (plugin.scope === "project" && onOpenFile) onOpenFile(`.yggdrasil/plugins/${plugin.manifest.id}/${file.path}`);
    else void window.yggdrasil.plugins.reveal(`${plugin.dir}/${file.path}`);
  };

  // Close the ⋯ menu on any click outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.yggdrasil.plugins.setStatus(plugin.scope, plugin.manifest.id, "published");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.yggdrasil.plugins.delete(plugin.scope, plugin.manifest.id);
      setConfirmDelete(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirmDelete(false);
      setBusy(false);
    }
  };

  // Divider drag: the preview's width is measured from the body's right edge.
  const onDividerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
  };
  const onDividerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing || !bodyRef.current) return;
    const rect = bodyRef.current.getBoundingClientRect();
    const max = Math.max(MIN_PANE, rect.width - MIN_PANE);
    setPreviewWidth(Math.round(Math.min(max, Math.max(MIN_PANE, rect.right - e.clientX))));
  };
  const onDividerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setResizing(false);
    if (previewWidth !== null) {
      try {
        localStorage.setItem(PREVIEW_WIDTH_KEY, String(previewWidth));
      } catch {
        // storage unavailable: the width just won't survive a restart
      }
    }
  };
  // Track the body's width so a saved preview width can't squeeze the agent
  // pane below MIN_PANE after the window shrinks.
  const [bodyWidth, setBodyWidth] = useState(0);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const ro = new ResizeObserver(() => setBodyWidth(body.clientWidth));
    ro.observe(body);
    return () => ro.disconnect();
  }, []);
  const effectivePreviewWidth =
    previewWidth === null || bodyWidth === 0
      ? previewWidth
      : Math.max(MIN_PANE, Math.min(previewWidth, bodyWidth - MIN_PANE - DIVIDER_W - BODY_PAD_X));
  const onStatusChange = useCallback((s: StudioPreviewStatus) => setStatus(s), []);

  const recent = files
    .filter((f) => f.mtimeMs > openedAt)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, RECENT_SHOWN);

  // Footer pipeline.
  const tested = status.ready && status.errors === 0;
  const blocker = !isDraft
    ? null
    : status.errors > 0
      ? t(status.errors === 1 ? "studio.flow.fixErrors_one" : "studio.flow.fixErrors_other", { count: status.errors })
      : missingPerms > 0
        ? t(missingPerms === 1 ? "studio.flow.permWarnings_one" : "studio.flow.permWarnings_other", { count: missingPerms })
        : !status.ready
          ? t("studio.flow.loading")
          : t("studio.flow.readyToPublish");
  const steps: { label: string; state: "done" | "current" | "todo" }[] = [
    { label: t("studio.flow.draft"), state: isDraft && !tested ? "current" : "done" },
    { label: t("studio.flow.tested"), state: !isDraft || tested ? "done" : "todo" },
    { label: t("studio.flow.published"), state: isDraft ? "todo" : "done" },
  ];

  return (
    <div className={`studio-workspace${resizing ? " studio-resizing" : ""}`}>
      <div className="studio-head">
        <span className="studio-glyph studio-glyph-lg">{pluginGlyph(plugin)}</span>
        <strong className="studio-head-name">{plugin.manifest.name}</strong>
        <span className={`scope-tag${isDraft ? " plugin-draft-tag" : ""}`}>
          {isDraft ? t("studio.tag.draft") : t("studio.tag.published")}
        </span>
        {plugin.scope === "global" && <span className="scope-tag">{t("studio.tag.global")}</span>}
        {status.errors > 0 && (
          <span className="studio-head-summary">
            {t(status.errors === 1 ? "studio.workspace.consoleErrors_one" : "studio.workspace.consoleErrors_other", {
              count: status.errors,
            })}
          </span>
        )}
        <span className="studio-spacer" />
        <div className="studio-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="studio-icon-btn"
            aria-label={t("studio.workspace.more")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="studio-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void window.yggdrasil.plugins.reveal(plugin.dir);
                }}
              >
                {t("studio.workspace.openFolder")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="studio-menu-danger"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              >
                {t("studio.workspace.deleteEllipsis")}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="studio-toolbar">
        <div className="studio-tabs" role="tablist" aria-label={t("studio.workspace.sections")}>
          {(["agent", "files", "settings"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={`studio-tab${tab === k ? " active" : ""}`}
              onClick={() => setTab(k)}
            >
              {k === "agent" && t("studio.tabs.agent")}
              {k === "files" && (
                <>
                  {t("studio.tabs.files")} <span className="studio-count">{files.length}</span>
                </>
              )}
              {k === "settings" && (
                <>
                  {t("studio.tabs.settings")}
                  {missingPerms > 0 && <span className="studio-count studio-count-warn">{missingPerms}</span>}
                </>
              )}
            </button>
          ))}
        </div>
        {tab === "agent" && (
          <>
            <div className="studio-seg" role="tablist" aria-label={t("studio.workspace.agentMode")}>
              {(["terminal", "chat"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  className={mode === m ? "active" : ""}
                  onClick={() => switchMode(m)}
                >
                  {mounted[m] && <span className="studio-live-dot" title={t("studio.workspace.sessionAlive")} />}
                  {m === "terminal" ? t("studio.workspace.modeTerminal") : t("studio.workspace.modeChat")}
                </button>
              ))}
            </div>
            {mode === "terminal" && (
              <select
                className="studio-harness-select"
                value={harness}
                onChange={(e) => requestHarness(e.target.value as StudioTerminalHarness)}
                title={t("studio.workspace.harnessTitle")}
              >
                {(harness === "claude" || isCliVisible("claude", onboardingSettings)) && <option value="claude">claude</option>}
                {(harness === "agy" || isCliVisible("antigravity", onboardingSettings)) && (
                  <option value="agy">agy (Antigravity)</option>
                )}
              </select>
            )}
          </>
        )}
        <span className="studio-spacer" />
        <div className="studio-seg" role="tablist" aria-label={t("studio.preview.as")} title={t("studio.preview.as")}>
          {VIEWS.map((v) => {
            const declared = declaredViews.includes(v);
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={view === v ? "active" : ""}
                disabled={!declared}
                title={declared ? undefined : t("studio.preview.notDeclared")}
                onClick={() => setView(v)}
              >
                {v === "tab" ? t("studio.create.viewTab") : v === "panel" ? t("studio.create.viewPanel") : t("studio.create.viewMobile")}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="studio-icon-btn"
          onClick={() => setVersion((n) => n + 1)}
          aria-label={t("studio.preview.reload")}
          title={t("studio.preview.reload")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>
      {error && <p className="error studio-error">{error}</p>}
      <div className="studio-workspace-body" ref={bodyRef}>
        <div className="studio-authoring-pane">
          <div className="studio-agent-area" style={{ display: tab === "agent" ? "flex" : "none" }}>
            {mounted.terminal && (
              <div className="studio-agent-slot" style={{ display: mode === "terminal" ? "flex" : "none" }}>
                <StudioTerminalPane
                  ref={terminalRef}
                  plugin={plugin}
                  projectPath={projectPath}
                  harness={harness}
                  initialPrompt={launchRef.current?.initialPrompt}
                />
              </div>
            )}
            {mounted.chat && (
              <div className="studio-agent-slot" style={{ display: mode === "chat" ? "flex" : "none" }}>
                <StudioChatPane ref={chatRef} plugin={plugin} />
              </div>
            )}
            {recent.length > 0 && (
              <div className="studio-recent">
                <span className="muted">{t("studio.files.recent")}</span>
                {recent.map((f) => (
                  <button key={f.path} type="button" className="mono studio-recent-file" onClick={() => openPluginFile(f)}>
                    {f.path}
                  </button>
                ))}
              </div>
            )}
          </div>
          {tab === "files" && <StudioFiles plugin={plugin} files={files} since={openedAt} onOpen={openPluginFile} />}
          {tab === "settings" && (
            <StudioSettings
              plugin={plugin}
              lint={lint}
              onSaved={() => {
                setVersion((n) => n + 1);
                refreshLint();
              }}
            />
          )}
        </div>
        <div
          className="studio-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("studio.workspace.resize")}
          onPointerDown={onDividerDown}
          onPointerMove={onDividerMove}
          onPointerUp={onDividerUp}
          onPointerCancel={onDividerUp}
        >
          <span />
        </div>
        <div
          className="studio-preview-col"
          style={effectivePreviewWidth !== null ? { width: effectivePreviewWidth, flex: "0 0 auto" } : undefined}
        >
          <StudioPreview plugin={plugin} view={view} version={version} onStatusChange={onStatusChange} onAskFix={askFix} />
        </div>
      </div>
      <footer className="studio-flow">
        {steps.map((s, i) => (
          <span key={s.label} className="studio-flow-item">
            {i > 0 && <span className={`studio-flow-line${s.state === "done" ? " done" : ""}`} aria-hidden="true" />}
            <span className={`studio-flow-step ${s.state}`}>
              <span className="studio-flow-dot" aria-hidden="true">
                {s.state === "done" ? "✓" : i + 1}
              </span>
              {s.label}
            </span>
          </span>
        ))}
        <span className="studio-spacer" />
        {blocker && <span className={`studio-flow-msg${status.errors > 0 || missingPerms > 0 ? " warn" : ""}`}>{blocker}</span>}
        {isDraft && (
          <button type="button" className="studio-primary-btn" onClick={() => void publish()} disabled={busy}>
            {t("studio.workspace.publish")}
          </button>
        )}
      </footer>
      {confirmDelete && (
        <StudioConfirm
          title={t("studio.workspace.deleteTitle")}
          body={t("studio.workspace.confirmDelete", { name: plugin.manifest.name })}
          confirmLabel={t("studio.workspace.delete")}
          danger
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {pendingHarness && (
        <StudioConfirm
          title={t("studio.workspace.switchCliTitle")}
          body={t("studio.workspace.switchCliBody", { cli: pendingHarness })}
          confirmLabel={t("studio.workspace.switchCliConfirm")}
          onConfirm={() => {
            setHarness(pendingHarness);
            setPendingHarness(null);
          }}
          onCancel={() => setPendingHarness(null)}
        />
      )}
    </div>
  );
}

type ConfirmProps = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Two-way confirm in the app's own modal chrome (.modal-overlay/.modal) — replaces window.confirm here. Overlay click and Escape cancel. */
function StudioConfirm({ title, body, confirmLabel, danger, busy, onConfirm, onCancel }: ConfirmProps) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
        </div>
        <p>{body}</p>
        <div className="agent-form-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            {t("ui.cancel")}
          </button>
          <button
            type="button"
            className={danger ? "studio-danger-btn" : "studio-primary-btn"}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
