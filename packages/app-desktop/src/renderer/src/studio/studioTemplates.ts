import type { PluginPermission, PluginView } from "../types.js";
import type { MessageKey } from "../i18n/index.js";

/**
 * Starting points for "Nuevo complemento" (StudioNew.tsx). A template only
 * presets the manifest (views, permissions) and adds a hint to the agent's
 * first message — the files themselves are still the standard scaffold,
 * the agent writes the real thing. `sampleHtml` is an illustration shown in
 * the preview while describing, never written to disk.
 */
export type StudioTemplate = {
  id: string;
  nameKey: MessageKey;
  descKey: MessageKey;
  views: PluginView[];
  permissions: PluginPermission[];
  /** Appended to the agent's first message (Spanish, like the rest of the Estudio's agent context). */
  agentHint: string;
  sampleHtml: string;
};

const SAMPLE_BASE = `<style>
body{margin:0;font-family:system-ui,sans-serif;background:#1a1918;color:#f1efe7;padding:16px;font-size:13px}
h1{font-size:16px;margin:0 0 12px}.muted{color:#a19f98}.card{background:#262523;border-radius:8px;padding:10px;margin-bottom:8px}
.row{display:flex;gap:8px}.pill{font-size:11px;padding:2px 8px;border-radius:999px;background:#3b3a37}
.col{flex:1;background:#262523;border-radius:8px;padding:8px}.col h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#a19f98;margin:0 0 8px}
.bar{height:6px;border-radius:3px;background:#3b3a37}.bar>span{display:block;height:100%;border-radius:3px;background:#d97757}
code{font-family:ui-monospace,monospace;font-size:12px}
</style>`;

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  {
    id: "board",
    nameKey: "studio.tpl.board",
    descKey: "studio.tpl.boardDesc",
    views: ["tab"],
    permissions: [],
    agentHint:
      "Plantilla: Tablero. Columnas (por ejemplo Pendiente / En curso / Hecho) con tarjetas que se pueden mover entre columnas, persistidas con ygg.storage.",
    sampleHtml: `${SAMPLE_BASE}<h1>Tablero</h1><div class="row">
<div class="col"><h2>Pendiente</h2><div class="card">Revisar PR</div><div class="card">Escribir docs</div></div>
<div class="col"><h2>En curso</h2><div class="card">Rediseño</div></div>
<div class="col"><h2>Hecho</h2><div class="card">Deploy</div><div class="card">Tests</div></div></div>`,
  },
  {
    id: "checklist",
    nameKey: "studio.tpl.checklist",
    descKey: "studio.tpl.checklistDesc",
    views: ["tab", "panel"],
    permissions: [],
    agentHint:
      "Plantilla: Checklist. Lista de ítems tildables con barra de progreso, agregar/borrar ítems, persistida con ygg.storage.",
    sampleHtml: `${SAMPLE_BASE}<h1>Checklist</h1><div class="bar" style="margin-bottom:12px"><span style="width:60%"></span></div>
<div class="card">☑ Configurar proyecto</div><div class="card">☑ Escribir README</div><div class="card">☐ Publicar versión</div>
<p class="muted">3 de 5 listos</p>`,
  },
  {
    id: "fileViewer",
    nameKey: "studio.tpl.fileViewer",
    descKey: "studio.tpl.fileViewerDesc",
    views: ["tab", "panel"],
    permissions: ["fs"],
    agentHint:
      "Plantilla: Visor de archivos. Lee archivos del proyecto con ygg.fs.list/ygg.fs.read (permiso fs ya declarado), los lista y muestra su contenido; se actualiza con el evento fs.changed.",
    sampleHtml: `${SAMPLE_BASE}<h1>Visor de archivos</h1><div class="row"><div style="width:40%">
<div class="card">📄 README.md</div><div class="card">📄 notes/plan.md</div><div class="card">📄 package.json</div></div>
<div class="col"><code># Proyecto<br><br>Descripción del proyecto…</code></div></div>`,
  },
  {
    id: "mobileWidget",
    nameKey: "studio.tpl.mobileWidget",
    descKey: "studio.tpl.mobileWidgetDesc",
    views: ["mobile"],
    permissions: [],
    agentHint:
      "Plantilla: Widget mobile. Una tarjeta compacta pensada para el celular (ancho ~390px), con un dato principal y una acción; persistida con ygg.storage.",
    sampleHtml: `${SAMPLE_BASE}<div class="card" style="text-align:center;padding:20px"><p class="muted" style="margin:0">Hoy</p>
<p style="font-size:32px;margin:8px 0">7 / 10</p><p class="muted" style="margin:0 0 12px">tareas completadas</p>
<span class="pill" style="background:#d97757;color:#1a1918">+ Agregar</span></div>`,
  },
  {
    id: "agentTool",
    nameKey: "studio.tpl.agentTool",
    descKey: "studio.tpl.agentToolDesc",
    views: ["panel"],
    permissions: [],
    agentHint:
      "Plantilla: Herramienta para agentes. Lo principal son tools declaradas en manifest.json (\"tools\") y registradas con ygg.tools.register, que los agentes del proyecto pueden llamar; la vista del panel solo muestra la lista de tools y las últimas llamadas.",
    sampleHtml: `${SAMPLE_BASE}<h1>Tools</h1><div class="card"><code>crear_tarea(titulo)</code><p class="muted" style="margin:4px 0 0">Crea una tarea en el tablero</p></div>
<div class="card"><code>listar_tareas()</code><p class="muted" style="margin:4px 0 0">Devuelve las tareas pendientes</p></div>
<p class="muted">Última llamada: crear_tarea("Revisar PR") → ok</p>`,
  },
  {
    id: "statusPanel",
    nameKey: "studio.tpl.statusPanel",
    descKey: "studio.tpl.statusPanelDesc",
    views: ["panel"],
    permissions: ["gateway:agents.list"],
    agentHint:
      "Plantilla: Panel de estado. Panel lateral con datos vivos del gateway vía ygg.gateway.call (permiso gateway:agents.list ya declarado; agregá en Ajustes los métodos que necesites), refrescando periódicamente.",
    sampleHtml: `${SAMPLE_BASE}<h1>Estado</h1><div class="card row" style="justify-content:space-between"><span>Agentes activos</span><b>3</b></div>
<div class="card row" style="justify-content:space-between"><span>Sesiones hoy</span><b>12</b></div>
<div class="card"><span class="muted">gateway</span> <span class="pill" style="background:#1f3524;color:#8fd19e">conectado</span></div>`,
  },
];

const LEADING_ARTICLES = new Set(["un", "una", "unos", "unas", "el", "la", "los", "las", "a", "an", "the"]);
const TRAILING_CONNECTORS = new Set([
  "con", "de", "del", "para", "por", "y", "o", "en", "a", "al", "que", "el", "la", "los", "las", "un", "una",
  "with", "for", "of", "and", "or", "to", "in", "on", "the", "a", "an", "that",
]);

/** "Un tablero de tareas del proyecto con filtros" → "Tablero de tareas": a short name suggestion from a description. */
export function suggestName(description: string): string {
  const words = description
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEADING_ARTICLES.has(words[0].toLowerCase())) words.shift();
  const kept = words.slice(0, 3);
  // "Contador simple con" → "Contador simple": never end on a connector.
  while (kept.length > 1 && TRAILING_CONNECTORS.has(kept[kept.length - 1].toLowerCase())) kept.pop();
  const picked = kept.join(" ");
  return picked ? picked[0].toUpperCase() + picked.slice(1) : "";
}

export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "complemento";
}

/** `base`, or `base-2`, `base-3`… — the first id not already taken in that scope. */
export function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 60)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
