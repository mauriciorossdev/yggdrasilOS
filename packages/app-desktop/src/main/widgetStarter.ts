// What a new Dashboard widget starts as: a manifest block and files that already
// follow the widget contract (theme, size, preview), for the agent to replace.
import type { WidgetSize } from "./widgetSpec.js";

export function starterWidgetBlock(size: WidgetSize) {
  return {
    defaultSize: size,
    refresh: { defaultSeconds: 3600, minSeconds: 900 },
    configSchema: { type: "object", properties: {} },
  };
}

export const STARTER_WIDGET_STYLES = `html, body { margin: 0; height: 100%; }
body { font: 13px/1.45 system-ui, sans-serif; background: var(--panel); color: var(--fg); }
#app { box-sizing: border-box; height: 100%; overflow: auto; padding: 8px 14px; display: flex; align-items: center; justify-content: center; text-align: center; }
.muted { color: var(--muted); }
`;

export const STARTER_WIDGET_JS = `// Widget del Dashboard. Ver README.md: ygg.ready().widget, ygg.net.fetch y ygg.on("refresh").
function applyTheme(theme) {
  for (const key of ["panel", "fg", "muted", "line", "accent"]) {
    document.documentElement.style.setProperty("--" + key, theme[key]);
  }
}

(async function () {
  const info = await ygg.ready();
  applyTheme(info.theme);
  ygg.on("theme", applyTheme);
  const es = !info.widget || info.widget.language === "es";
  const text = document.createElement("p");
  text.className = "muted";
  text.textContent = es ? "Tu widget aparecerá aquí." : "Your widget will appear here.";
  document.getElementById("app").replaceChildren(text);
})();
`;
