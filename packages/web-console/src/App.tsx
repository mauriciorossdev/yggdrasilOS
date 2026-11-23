import { lazy, useEffect, useRef } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { Layout } from "./components/Layout";
import { GatewayProvider, useGateway } from "@yggdrasil/client-web";
import "./styles.css";
import { useT } from "./i18n";

// One chunk per page, loaded the first time it opens, so the shell stays small
// (Layout shows "loading" in the page area meanwhile).
const ChatPage = lazy(() => import("./pages/Chat").then((m) => ({ default: m.ChatPage })));
const OverviewPage = lazy(() => import("./pages/Overview").then((m) => ({ default: m.OverviewPage })));
const SessionsPage = lazy(() => import("./pages/Sessions").then((m) => ({ default: m.SessionsPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const ProvidersPage = lazy(() => import("./pages/Providers").then((m) => ({ default: m.ProvidersPage })));
const AgentsPage = lazy(() => import("./pages/Agents").then((m) => ({ default: m.AgentsPage })));
const DocumentsPage = lazy(() => import("./pages/Documents").then((m) => ({ default: m.DocumentsPage })));
const MemoryPage = lazy(() => import("./pages/Memory").then((m) => ({ default: m.MemoryPage })));
const WorkflowsPage = lazy(() => import("./pages/Workflows").then((m) => ({ default: m.WorkflowsPage })));
const McpPage = lazy(() => import("./pages/Mcp").then((m) => ({ default: m.McpPage })));
const RepositoryPage = lazy(() => import("./pages/Repository").then((m) => ({ default: m.RepositoryPage })));
const FilesPage = lazy(() => import("./pages/Files").then((m) => ({ default: m.FilesPage })));
const TerminalsPage = lazy(() => import("./pages/Terminals").then((m) => ({ default: m.TerminalsPage })));

function Boot() {
  const { connect, health, connected } = useGateway();
  const t = useT();
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void connect().catch((err) => {
      console.error("[yggdrasil-ui] gateway connect failed:", err);
    });
  }, [connect]);

  if (!health && !connected) {
    return (
      <div className="auth-gate">
        <p className="muted">{t("common.connecting")}</p>
      </div>
    );
  }

  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<OverviewPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="workflows" element={<WorkflowsPage />} />
          <Route path="mcp" element={<McpPage />} />
          <Route path="repository" element={<RepositoryPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="terminals" element={<TerminalsPage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}

export function App() {
  return (
    <GatewayProvider>
      <BrowserRouter basename="/ui">
        <Boot />
      </BrowserRouter>
    </GatewayProvider>
  );
}
