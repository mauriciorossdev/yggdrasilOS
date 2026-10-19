import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { ChatView } from "./chat/ChatView.js";

export function App() {
  const { connected, authenticated, connect } = useGateway();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    connect().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [connect]);

  if (error) {
    return (
      <div className="app-status">
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!connected || !authenticated) {
    return (
      <div className="app-status">
        <p>Connecting to gateway…</p>
      </div>
    );
  }

  return <ChatView />;
}
