import { useEffect, useState } from "react";
import {
  ArrowsPointingOutIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  Cog6ToothIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  SparklesIcon,
} from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import type { IndexProgress } from "../types.js";
import type { AgentInfo, PluginRecord, ProjectRecord, SessionInfo } from "../types.js";
import { SessionContextMenu } from "./SessionContextMenu.js";
import { ProjectContextMenu } from "./ProjectContextMenu.js";
import { FileTree } from "../files/FileTree.js";
import { RemoteFilesPanel, type DiffTarget } from "../files/RemoteFilesPanel.js";
import { BranchIcon } from "../files/FileIcons.js";
import { useGitChanges } from "../files/useGitChanges.js";
import { ScriptsSection } from "../files/ScriptsSection.js";
import { PluginsSection } from "../plugins/PluginsSection.js";
import { MainNav } from "./MainNav.js";
import { setActiveTab } from "../ui/mainTabsStore.js";
import { toggleSidebarCollapsed, useSidebarCollapsed } from "../ui/sidebarStore.js";

import { useProjects } from "../projects/useProjects.js";
import { useI18n } from "../i18n/index.js";
import { CollapsibleSection } from "../components/CollapsibleSection.js";
/** Circumference of the indexing ring (r = 10 in a 24-unit viewBox). */
const RING = 2 * Math.PI * 10;

type Props = {
  sessions: SessionInfo[];
  activeSessionKey: string | null;
  onSelectSession: (sessionKey: string) => void;
  onNewChat: () => void;
  onManageAgents: () => void;
  onOpenSettings: () => void;
  onRenameSession: (sessionKey: string, title: string) => void;
  onDeleteSession: (sessionKey: string) => void;
  agents: AgentInfo[];
  activeAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onOpenFile: (relativePath: string) => void;
  /** Remote Diff: show one changed file's diff in the side panel. */
  onOpenDiff: (target: DiffTarget) => void;
  /** Repo path of the diff open in the side panel, if any. */
  activeDiffPath?: string;
  plugins: PluginRecord[];
  onOpenPlugin: (key: string) => void;
  onOpenPluginTab: (key: string) => void;
  onOpenPluginPanel: (key: string) => void;
  onReloadPlugins: () => void;
};

type MenuState = { session: SessionInfo; x: number; y: number };
type ProjectMenuState = { project: ProjectRecord; x: number; y: number };

export function SessionSidebar({
  sessions,
  activeSessionKey,
  onSelectSession,
  onNewChat,
  onManageAgents,
  onOpenSettings,
  onRenameSession,
  onDeleteSession,
  agents,
  activeAgentId,
  onSelectAgent,
  onOpenFile,
  onOpenDiff,
  activeDiffPath,
  plugins,
  onOpenPlugin,
  onOpenPluginTab,
  onOpenPluginPanel,
  onReloadPlugins,
}: Props) {
  const { t } = useI18n();
  const collapsed = useSidebarCollapsed();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null);
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);
  const [filesTab, setFilesTab] = useState<"local" | "remote">("local");
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);
  const { projects, error: projectsError, openExisting, createNew, open, rename, reveal, openInIde, clone, remove, purge } =
    useProjects();
  const { call, onEvent } = useGateway();
  const git = useGitChanges();
  const projectPath = projects.find(
    (p) => p.id === window.yggdrasil.projectId,
  )?.path;

  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.event === "project_index.progress") setIndexProgress(ev.payload as IndexProgress);
      }),
    [onEvent],
  );

  const indexProject = async () => {
    if (isIndexing) return;
    setIsIndexing(true);
    setIndexError(null);
    setIndexProgress(null);
    try {
      await call("project_index_all", {});
      setFilesRefreshKey((k) => k + 1);
    } catch (err) {
      setIndexError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsIndexing(false);
      setIndexProgress(null);
    }
  };

  const indexPercent =
    isIndexing && indexProgress && indexProgress.total > 0
      ? Math.min(100, (indexProgress.processed / indexProgress.total) * 100)
      : 0;
  const indexTip = !isIndexing
    ? t("chat.sidebar.index")
    : indexProgress && indexProgress.total > 0
      ? t("chat.sidebar.indexingProgress", { processed: indexProgress.processed, total: indexProgress.total })
      : t("chat.sidebar.indexing");

  return (
    <aside className={collapsed ? "sidebar sidebar--collapsed" : "sidebar"}>
      <div className="sidebar-top">
        <button
          type="button"
          className="new-chat"
          onClick={onNewChat}
          title={collapsed ? t("chat.sidebar.newChat") : undefined}
          aria-label={t("chat.sidebar.newChat")}
        >
          {collapsed ? <PlusIcon className="hero-icon" /> : t("chat.sidebar.newChatBtn")}
        </button>
        <button
          type="button"
          className="icon-btn sidebar-collapse-btn"
          onClick={toggleSidebarCollapsed}
          title={collapsed ? t("chat.sidebar.expand") : t("chat.sidebar.collapse")}
          aria-label={collapsed ? t("chat.sidebar.expand") : t("chat.sidebar.collapse")}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDoubleRightIcon className="hero-icon" /> : <ChevronDoubleLeftIcon className="hero-icon" />}
        </button>
      </div>

      <MainNav collapsed={collapsed} />

      {/* Sections stay mounted while collapsed (hidden by CSS) so file-tree expansion, index progress etc. survive a toggle. */}
      <div className="sidebar-sections">
        {window.yggdrasil.isDefaultProject && (
          <CollapsibleSection
            title={t("chat.sidebar.projects")}
            id="projects"
            count={projects.length}
            actions={
              <div className="collapsible-actions">
                <button
                  type="button"
                  className="icon-btn"
                  title={t("chat.sidebar.openFolder")}
                  onClick={() => void openExisting()}
                >
                  <FolderOpenIcon className="hero-icon" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={t("chat.sidebar.newProject")}
                  onClick={() => void createNew()}
                >
                  <PlusIcon className="hero-icon" />
                </button>
              </div>
            }
          >
            <ul>
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`session-item ${p.id === window.yggdrasil.projectId ? "active" : ""}`}
                    onClick={() => void open(p.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setProjectMenu({
                        project: p,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    title={p.path}
                  >
                    <span className="project-list-color-dot" style={{ background: p.color || "transparent" }} />
                    {p.name}
                  </button>
                </li>
              ))}
              {projects.length === 0 && (
                <li className="muted">{t("chat.sidebar.noProjects")}</li>
              )}
              {projectsError && <li className="error">{projectsError}</li>}
            </ul>
          </CollapsibleSection>
        )}

        <CollapsibleSection title={t("chat.sidebar.sessions")} id="sessions" count={sessions.length} className="sessions-section">
          <ul>
            {sessions.map((s) => (
              <li key={s.sessionKey}>
                <button
                  type="button"
                  className={`session-item ${s.sessionKey === activeSessionKey ? "active" : ""}`}
                  onClick={() => onSelectSession(s.sessionKey)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ session: s, x: e.clientX, y: e.clientY });
                  }}
                >
                  {s.title || s.sessionKey}
                </button>
              </li>
            ))}
            {sessions.length === 0 && (
              <li className="muted">{t("chat.sidebar.noSessions")}</li>
            )}
          </ul>
        </CollapsibleSection>

        <CollapsibleSection
          title={t("chat.sidebar.agents")}
          id="agents"
          count={agents.length}
          actions={
            <button
              type="button"
              className="icon-btn"
              title={t("chat.sidebar.manageAgentsTip")}
              onClick={onManageAgents}
            >
              <PlusIcon className="hero-icon" />
            </button>
          }
        >
          <ul>
            {agents.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`session-item ${a.id === activeAgentId ? "active" : ""}`}
                  onClick={() => onSelectAgent(a.id)}
                  title={`${a.provider ?? "?"}/${a.model ?? "?"}`}
                >
                  {a.label ?? a.id}
                  {a.scope && <span className="scope-tag">{a.scope}</span>}
                </button>
              </li>
            ))}
            {agents.length === 0 && <li className="muted">{t("chat.sidebar.noAgents")}</li>}
          </ul>
        </CollapsibleSection>

        <CollapsibleSection
          title={t("chat.sidebar.files")}
          id="files"
          badge={git.count}
          className="files-section"
          actions={
            <div className="files-header-actions">
              <div className="files-seg" role="tablist" aria-label={t("chat.sidebar.filesView")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filesTab === "local"}
                  aria-label={t("chat.sidebar.local")}
                  data-tip={t("chat.sidebar.local")}
                  className={`icon-btn tip${filesTab === "local" ? " on" : ""}`}
                  onClick={() => setFilesTab("local")}
                >
                  <FolderIcon className="hero-icon" />
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filesTab === "remote"}
                  aria-label={t("chat.sidebar.remoteDiff")}
                  data-tip={t("chat.sidebar.remoteDiff")}
                  className={`icon-btn tip tip-r${filesTab === "remote" ? " on" : ""}`}
                  onClick={() => setFilesTab("remote")}
                >
                  <BranchIcon />
                  {git.count > 0 && <span className="files-badge">{git.count > 99 ? "99+" : git.count}</span>}
                </button>
              </div>
              <button
                type="button"
                className="icon-btn tip tip-r"
                data-tip={t("chat.sidebar.openExplorer")}
                aria-label={t("chat.sidebar.openExplorer")}
                onClick={() => setActiveTab("files")}
              >
                <ArrowsPointingOutIcon className="hero-icon" />
              </button>
            </div>
          }
        >
          {isIndexing && (
            <div className="files-progress" role="progressbar" aria-label={t("chat.sidebar.indexingAria")}>
              <i style={{ width: `${indexPercent}%` }} />
            </div>
          )}

          {filesTab === "local" ? (
            <>
              {indexError && (
                <p className="error" style={{ margin: "0 12px 4px", fontSize: 12 }}>
                  {indexError}
                </p>
              )}
              <FileTree
                key={filesRefreshKey}
                onOpenFile={onOpenFile}
                gitDecor={git.decor}
                searchable
                toolbarEnd={
                  <button
                    type="button"
                    className={`icon-btn tip tip-r files-index${isIndexing ? " busy" : ""}`}
                    data-tip={indexTip}
                    aria-label={t("chat.sidebar.index")}
                    aria-busy={isIndexing}
                    onClick={() => void indexProject()}
                  >
                    <svg className="files-ring" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="trk" cx="12" cy="12" r="10" />
                      <circle
                        className={`val${indexProgress && indexProgress.total > 0 ? "" : " indeterminate"}`}
                        cx="12"
                        cy="12"
                        r="10"
                        style={{ strokeDashoffset: RING * (1 - indexPercent / 100) }}
                      />
                    </svg>
                    <SparklesIcon className="hero-icon" />
                  </button>
                }
              />
            </>
          ) : (
            <RemoteFilesPanel onOpenDiff={onOpenDiff} activePath={activeDiffPath} />
          )}
        </CollapsibleSection>

        <PluginsSection
          plugins={plugins}
          onOpen={onOpenPlugin}
          onOpenTab={onOpenPluginTab}
          onOpenPanel={onOpenPluginPanel}
          onReload={onReloadPlugins}
        />

        <ScriptsSection projectPath={projectPath} />
      </div>

      <div className="sidebar-footer">
        <button type="button" className="link-btn sidebar-footer-manage" onClick={onManageAgents}>
          {t("chat.sidebar.manageAgents")}
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={onOpenSettings}
          title={collapsed ? t("chat.sidebar.settings") : undefined}
          aria-label={t("chat.sidebar.settings")}
        >
          <Cog6ToothIcon className="hero-icon" />
          {!collapsed && ` ${t("chat.sidebar.settings")}`}
        </button>
      </div>

      {menu && (
        <SessionContextMenu
          session={menu.session}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={onRenameSession}
          onDelete={onDeleteSession}
        />
      )}

      {projectMenu && (
        <ProjectContextMenu
          project={projectMenu.project}
          locked={projectMenu.project.id === window.yggdrasil.projectId}
          x={projectMenu.x}
          y={projectMenu.y}
          onClose={() => setProjectMenu(null)}
          onOpen={(id) => void open(id)}
          onReveal={(id) => void reveal(id)}
          onOpenInIde={(id) =>
            void openInIde(id).then((opened) => {
              if (!opened) onOpenSettings();
            })
          }
          onClone={(id) => void clone(id)}
          onRename={(id, name) => void rename(id, name)}
          onRemove={(id) => void remove(id)}
          onPurge={(id) => void purge(id)}
        />
      )}
    </aside>
  );
}
