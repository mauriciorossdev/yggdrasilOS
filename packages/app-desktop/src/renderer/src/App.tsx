import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { ChatView } from "./chat/ChatView.js";
import { TitleBar } from "./components/TitleBar.js";
import { WorkspaceOverlay } from "./workspace/WorkspaceOverlay.js";
import { OnboardingGate } from "./onboarding/OnboardingGate.js";

export function App() {
  const { connected, authenticated, connect } = useGateway();
  const [error, setError] = useState<string | null>(null);
  // Once the first handshake has succeeded, ChatView stays mounted through
  // any later drop (client-web auto-reconnects — see gateway-client.ts):
  // swapping back to the "Connecting…" screen would unmount every terminal
  // pane, open document tab and chat draft for what's usually a sub-second
  // blip (Electron dropping the loopback socket across a macOS sleep/wake).
  const [everReady, setEverReady] = useState(false);
  const ready = connected && authenticated;

  useEffect(() => {
    connect().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [connect]);

  useEffect(() => {
    if (ready) setEverReady(true);
  }, [ready]);

  if (error) {
    return (
      <div className="app-shell">
        <TitleBar />
        <div className="app-status">
          <p className="error">{error}</p>
        </div>
      </div>
    );
  }

  if (!ready && !everReady) {
    return (
      <div className="app-shell">
        <TitleBar />
        <div className="app-status">
          <p>Connecting to gateway…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TitleBar />
      {!ready && <div className="gateway-reconnect-banner">Reconnecting to gateway…</div>}
      <ChatView />
      <WorkspaceOverlay />
      <OnboardingGate />
    </div>
  );
}
