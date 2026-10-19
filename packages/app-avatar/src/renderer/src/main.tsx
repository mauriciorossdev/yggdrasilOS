import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GatewayProvider } from "@yggdrasil/client-web";
import { App } from "./App.js";
import { installFrameLogging } from "./logFrames.js";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
const gatewayUrl = window.yggdrasil.gatewayUrl;

window.addEventListener("error", (event) => {
  void window.yggdrasil.log.write("error", { message: event.message, source: event.filename, line: event.lineno });
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  void window.yggdrasil.log.write("unhandledRejection", { message: reason });
});
installFrameLogging();

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
