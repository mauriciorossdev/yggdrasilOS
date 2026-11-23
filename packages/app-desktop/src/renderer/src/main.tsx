import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GatewayProvider } from "@yggdrasil/client-web";
import { App } from "./App.js";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/jetbrains-mono";
import "@yggdrasil/ui-kit/tokens.css";
import "@yggdrasil/ui-kit/ui.css";
import "./styles.css";
import { applyTheme, KitHostProvider, type KitHost } from "@yggdrasil/ui-kit";
import { t } from "./i18n/index.js";

// Theme first (before any render) so the first frame already has the user's colors.
applyTheme(window.yggdrasil.theme.initial);
window.yggdrasil.theme.onChange(applyTheme);

// What the shared kit components (chat, providers, agents) need from Electron.
const kitHost: KitHost = {
  projectPath: window.yggdrasil.projectPath ?? undefined,
  openExternal: (url) => void window.yggdrasil.onboarding.openExternal(url),
  customRoles: { list: () => window.yggdrasil.roles.listCustom(), save: (input) => window.yggdrasil.roles.saveCustom(input) },
};

const root = createRoot(document.getElementById("root")!);
const gatewayUrl = window.yggdrasil.gatewayUrl;

if (!gatewayUrl) {
  root.render(
    <StrictMode>
      <p className="error">{t("app.noGatewayUrl")}</p>
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <GatewayProvider wsUrl={gatewayUrl}>
        <KitHostProvider host={kitHost}>
          <App />
        </KitHostProvider>
      </GatewayProvider>
    </StrictMode>,
  );
}
