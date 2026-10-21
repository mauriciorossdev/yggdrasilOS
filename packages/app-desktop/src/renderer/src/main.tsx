import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GatewayProvider } from "@yggdrasil/client-web";
import { App } from "./App.js";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/jetbrains-mono";
import "./ui/theme/tokens.css";
import "./ui/ui.css";
import "./styles.css";
import { applyTheme } from "./ui/theme/themeRuntime.js";

// Theme first (before any render) so the first frame already has the user's colors.
applyTheme(window.yggdrasil.theme.initial);
window.yggdrasil.theme.onChange(applyTheme);

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
