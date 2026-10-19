import { useEffect, useRef } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { Layout } from "./components/Layout";
import { GatewayProvider, useGateway } from "@yggdrasil/client-web";
import { ChatPage } from "./pages/Chat";
import { OverviewPage } from "./pages/Overview";
import { SessionsPage } from "./pages/Sessions";
import { SettingsPage } from "./pages/Settings";
import "./styles.css";

function Boot() {
  const { connect, health, connected } = useGateway();
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
        <p className="muted">Conectando al gateway…</p>
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
