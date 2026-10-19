import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GatewayProvider } from "@yggdrasil/client-web";
import { App } from "./App.js";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
const gatewayUrl = window.yggdrasil.gatewayUrl;

if (!gatewayUrl) {
  root.render(
    <StrictMode>
      <p className="error">No gateway URL for this window.</p>
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <GatewayProvider wsUrl={gatewayUrl}>
        <App />
      </GatewayProvider>
    </StrictMode>,
  );
}
