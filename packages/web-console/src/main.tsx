import { createRoot } from "react-dom/client";
import "@yggdrasil/ui-kit/tokens.css";
import "@yggdrasil/ui-kit/ui.css";
import "@yggdrasil/ui-kit/components.css";
import { App } from "./App";
import { applyPreset, savedPresetId } from "./theme";
import { initLanguage } from "./i18n";

applyPreset(savedPresetId());
initLanguage();
createRoot(document.getElementById("root")!).render(<App />);
