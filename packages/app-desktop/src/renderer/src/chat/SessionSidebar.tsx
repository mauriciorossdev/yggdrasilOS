import { useEffect, useState } from "react";
import { Cog6ToothIcon, FolderOpenIcon, PlusIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import type { IndexProgress } from "../types.js";
import type { AgentInfo, PluginRecord, ProjectRecord, SessionInfo } from "../types.js";
import { SessionContextMenu } from "./SessionContextMenu.js";
import { ProjectContextMenu } from "./ProjectContextMenu.js";
import { FileTree } from "../files/FileTree.js";
import { RemoteFilesPanel } from "../files/RemoteFilesPanel.js";
import { ScriptsSection } from "../files/ScriptsSection.js";
import { PluginsSection } from "../plugins/PluginsSection.js";

import { useProjects } from "../projects/useProjects.js";
import { CollapsibleSection } from "../components/CollapsibleSection.js";
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
  plugins,
  onOpenPlugin,
  onOpenPluginTab,
  onOpenPluginPanel,
  onReloadPlugins,
}: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null);
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);
  const [filesTab, setFilesTab] = useState<"local" | "remote">("local");
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);
  const { projects, openExisting, createNew, open, rename } = useProjects();
  const { call, onEvent } = useGateway();
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

  return (
    <aside className="sidebar">
      <button type="button" className="new-chat" onClick={onNewChat}>
        + New chat
      </button>

      <div className="sidebar-sections">
        {window.yggdrasil.isDefaultProject && (
          <CollapsibleSection
            title="Projects"
            actions={
              <div className="collapsible-actions">
                <button
                  type="button"
                  className="icon-btn"
                  title="Open folder…"
                  onClick={() => void openExisting()}
                >
                  <FolderOpenIcon className="hero-icon" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="New project…"
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
                <li className="muted">No projects yet</li>
              )}
            </ul>
          </CollapsibleSection>
        )}

        <CollapsibleSection title="Sessions" className="sessions-section">
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
              <li className="muted">No sessions yet</li>
            )}
          </ul>
        </CollapsibleSection>

        <CollapsibleSection
          title="Agents"
          actions={
            <button
              type="button"
              className="icon-btn"
              title="Manage agents…"
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
            {agents.length === 0 && <li className="muted">No agents yet</li>}
          </ul>
        </CollapsibleSection>

        <CollapsibleSection title="Files" className="files-section">
          <div className="files-tab-bar">
            <button
              type="button"
              className={`files-tab ${filesTab === "local" ? "active" : ""}`}
              onClick={() => setFilesTab("local")}
            >
              Local
            </button>
            <button
              type="button"
              className={`files-tab ${filesTab === "remote" ? "active" : ""}`}
              onClick={() => setFilesTab("remote")}
            >
              Remote
            </button>
          </div>

          {filesTab === "local" ? (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "4px 12px",
                  borderBottom: "1px solid #2a2d33",
                }}
              >
                <button
                  type="button"
                  className="link-btn"
                  onClick={indexProject}
                  disabled={isIndexing}
                  style={{ color: isIndexing ? "green" : "inherit" }}
                >
                  {isIndexing
                    ? indexProgress && indexProgress.total > 0
                      ? `Indexing… ${indexProgress.processed}/${indexProgress.total}`
                      : "Indexing..."
                    : "Indx"}
                </button>
                <div
                  style={{
                    flex: 1,
                    background: "#2a2d33",
                    borderRadius: 2,
                    height: 4,
                    alignSelf: "center",
                  }}
                >
                  <div
                    style={{
                      background: isIndexing ? "green" : "transparent",
                      height: "100%",
                      width:
                        isIndexing && indexProgress && indexProgress.total > 0
                          ? `${Math.min(100, (indexProgress.processed / indexProgress.total) * 100)}%`
                          : "0%",
                      transition: "width 100ms linear",
                    }}
                  />
                </div>
              </div>
              {indexError && (
                <p className="error" style={{ margin: "0 12px 4px", fontSize: 12 }}>
                  {indexError}
                </p>
              )}
              <FileTree key={filesRefreshKey} onOpenFile={onOpenFile} />
            </>
          ) : (
            <RemoteFilesPanel />
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
        <button type="button" className="link-btn" onClick={onManageAgents}>
          Manage agents
        </button>
        <button type="button" className="link-btn" onClick={onOpenSettings}>
          <Cog6ToothIcon className="hero-icon" /> Settings
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
          x={projectMenu.x}
          y={projectMenu.y}
          onClose={() => setProjectMenu(null)}
          onRename={(id, name) => void rename(id, name)}
        />
      )}
    </aside>
  );
}
