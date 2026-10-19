/**
 * The complemento API reference — used in three places so it only needs to
 * be accurate once: dropped into every scaffold_plugin's own README.md,
 * returned verbatim by the read_plugin_api_docs MCP tool, and embedded in
 * this project's .claude/yggdrasil-plugins-guide.md (mcpConfig.ts).
 */
export const PLUGIN_API_DOCS = `# API de complementos (Yggdrasil desktop)

Un complemento es una carpeta con \`manifest.json\` + HTML/JS/CSS propios, que la app desktop
carga en un \`<iframe>\` aislado (sandbox, sin \`allow-same-origin\`) y muestra en el sidebar
("Complementos"), como pestaña principal y/o como panel lateral — y, si el manifest lo declara,
también en la pestaña Complementos de la app mobile — según lo que declare el manifest.

No hay build ni bundler: escribí HTML/JS/CSS planos. \`index.html\` debe incluir el SDK:

\`\`\`html
<script src="ygg-plugin://sdk/ygg.js"></script>
\`\`\`

## manifest.json

\`\`\`json
{
  "id": "tareas",
  "name": "Tareas",
  "version": "0.1.0",
  "icon": "📋",
  "entry": "index.html",
  "views": ["tab", "panel"],
  "defaultView": "tab",
  "permissions": ["fs", "panes"]
}
\`\`\`

- \`id\`: minúsculas/números/guiones, máx 64 — debe coincidir con el nombre de la carpeta.
- \`views\`: dónde se puede abrir — \`"tab"\` (pestaña principal, junto a Chat/Terminal/Docs),
  \`"panel"\` (aside derecho, igual que un archivo abierto, o drawer flotante sobre Terminal), y/o
  \`"mobile"\` (pestaña Complementos de la app Yggdrasil para el teléfono — agregalo si el usuario
  lo quiere usable desde el celular, no solo desde desktop). Un complemento con \`"mobile"\` se ve
  en el teléfono con un subconjunto de \`window.ygg\` (sin \`panes\`, \`tools.register\` ni
  \`gateway.call\`, y \`fs\` solo lectura ahí) — ver la guía del repo mobile para el detalle.
- \`permissions\` (todas opcionales, sin ninguna el complemento solo tiene storage propio y las
  utilidades de \`app.*\`):
  - \`"fs"\`: \`ygg.fs.list\`/\`ygg.fs.read\` (lectura del proyecto) + evento \`fs.changed\`.
  - \`"fs:write"\`: \`ygg.fs.write\`/\`ygg.fs.mkdir\`.
  - \`"panes"\`: \`ygg.panes.*\` (listar/crear/escribir terminales, igual que el tool \`panes\`).
  - \`"gateway:<método>"\` (uno por método exacto, ej. \`"gateway:chat.send"\`): habilita ese único
    método vía \`ygg.gateway.call\`. Los métodos \`fs.*\` están bloqueados ahí a propósito — usar
    \`ygg.fs.*\` en su lugar.

## window.ygg (una vez cargado el script del SDK)

\`\`\`js
const { plugin, project, theme } = await ygg.ready(); // espera el handshake inicial

await ygg.storage.set("items", [...]);
const items = await ygg.storage.get("items");
await ygg.storage.delete("items");
const keys = await ygg.storage.keys();

const list = await ygg.fs.list("subcarpeta");      // requiere "fs"
const { content } = await ygg.fs.read("notas.md");  // requiere "fs"
await ygg.fs.write("notas.md", "contenido");        // requiere "fs:write"
await ygg.fs.mkdir("subcarpeta");                   // requiere "fs:write"

const result = await ygg.gateway.call("algún.método", { ... }); // requiere "gateway:algún.método"

const panes = await ygg.panes.list();               // requiere "panes"
const { id } = await ygg.panes.create({ command: "claude", title: "Worker" });
await ygg.panes.write(id, "hacé esto", true);

ygg.app.openFile("notas.md");
ygg.app.openTab("terminal"); // o "chat" | "documents" | "browser" | "agentFlow"
const t = await ygg.app.theme();
ygg.app.notify("Listo", "La tarea se completó");
const info = await ygg.app.info();

const off = ygg.on("theme", (t) => { ... });        // "theme" | "visibility" | "fs.changed" | "storage.changed"
off(); // deja de escuchar
\`\`\`

## tools (exponer funciones al resto del proyecto)

\`\`\`json
"tools": [
  { "name": "crear_tarea", "description": "Crea una tarea nueva", "inputSchema": { "type": "object", "properties": { "titulo": { "type": "string" } }, "required": ["titulo"] } }
]
\`\`\`

\`\`\`js
ygg.tools.register("crear_tarea", async (params) => {
  // leer/escribir con ygg.storage.* como cualquier otro código del complemento
  return { ok: true };
});
\`\`\`

- Cada complemento nuevo nace con una tool de ejemplo ya registrada y funcionando (\`ping\`) — no
  hace falta agregar la primera a mano, solo reemplazarla o sumar más según lo que haga el
  complemento (ej. \`crear_tarea\` en un Kanban).
- Solo complementos **publicados** exponen sus tools — un borrador (\`status:"draft"\`) no es
  invocable desde afuera, igual que ya no aparece en el sidebar.
- El handler corre dentro del propio iframe del complemento, headless si no está abierto en ese
  momento (no hace falta tenerlo a la vista para que responda) — y puede usar el resto de
  \`window.ygg\` (\`storage\`/\`fs\`/\`panes\`/\`gateway.call\`) con los mismos permisos que ya declaró
  el manifest, ni más ni menos.
- **v1: solo alcanzable desde una sesión de terminal \`claude\`/\`agy\` en este proyecto**, vía el
  tool MCP \`plugins\` (aparece dinámicamente como \`<scope>-<id>__<tool>\`, ej. \`project-kanban__crear_tarea\`).
  El Chat integrado de la app todavía no puede llamar estas tools.
- Nombre de la tool: minúsculas o mayúsculas, números, \`_\`/\`-\`, máx 64 caracteres — una tool con
  nombre inválido se ignora (con un aviso) en vez de romper todo el manifest.

## Storage

\`ygg.storage.*\` es JSON simple por complemento, persistido por la app (no en el navegador). Un
complemento de scope \`project\` tiene su propio storage por proyecto; uno de scope \`global\` comparte
el mismo storage en todas las ventanas/proyectos.

## Recarga en caliente

La app vigila la carpeta del complemento — al guardar un archivo, el iframe se recarga solo
(no hace falta reiniciar la app ni el complemento).

## Importante: sin localStorage

El iframe corre en un origen opaco (por seguridad, sin \`allow-same-origin\`), así que
\`localStorage\`/\`sessionStorage\`/cookies NO persisten ahí. Usá siempre \`ygg.storage.*\` para
cualquier dato que deba sobrevivir una recarga o un reinicio de la app.

## Qué SÍ funciona como una página normal

El sandbox del iframe permite \`alert\`/\`confirm\`/\`prompt\`, descargas (un \`<a download>\` o
similar — ej. exportar un canvas a PNG), y formularios nativos. NO permite abrir popups nuevos
ni navegar la ventana top-level — si necesitás compartir algo afuera, usá \`ygg.app.notify\` o
guardalo con \`ygg.fs.write\` (requiere permiso \`"fs:write"\`) en vez de intentar \`window.open\`.

## Herramientas del agente (MCP \`plugins\`)

- \`scaffold_plugin\`: crea la carpeta + manifest + starter files.
- \`list_plugins\`: lista los complementos visibles en este proyecto (propios + globales).
- \`reload_plugin\`: fuerza una relectura inmediata (normalmente no hace falta, la recarga es automática).
- \`open_plugin\`: le pide a la app que abra un complemento (pestaña o panel) para que el usuario lo vea.
- \`read_plugin_api_docs\`: devuelve este mismo documento.
`;
