import { StrictMode, useState } from "react";
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
import { BootScreen } from "./boot/BootScreen.js";
import { startBoot, useBoot } from "./boot/bootStore.js";

// Theme first (before any render) so the first frame already has the user's colors.
applyTheme(window.yggdrasil.theme.initial);
window.yggdrasil.theme.onChange(applyTheme);

// What the shared kit components (chat, providers, agents) need from Electron.
const kitHost: KitHost = {
  projectPath: window.yggdrasil.projectPath ?? undefined,
  openExternal: (url) => void window.yggdrasil.onboarding.openExternal(url),
  customRoles: { list: () => window.yggdrasil.roles.listCustom(), save: (input) => window.yggdrasil.roles.saveCustom(input) },
};

// Window-first boot: this window opened before its gateway existed. The boot screen covers it with the
// real startup stages; the app mounts underneath once main hands over the gateway, and the boot screen
// fades out when that connection is authenticated (App calls markConnected).
startBoot();

function Root() {
  const { snapshot } = useBoot();
  const [booting, setBooting] = useState(true);
  const gatewayUrl = snapshot?.gateway?.url;
  return (
    <>
      {gatewayUrl && (
        <GatewayProvider wsUrl={gatewayUrl}>
          <KitHostProvider host={kitHost}>
            <App />
          </KitHostProvider>
        </GatewayProvider>
      )}
      {booting && <BootScreen onDone={() => setBooting(false)} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
