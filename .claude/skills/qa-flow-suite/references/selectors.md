# Catálogo de selectores DOM — app-desktop renderer

Consolidado de tres investigaciones (2026-10-01) + lo ya validado en vivo
esta sesión. `packages/app-desktop/src/renderer/src/` tiene **cero**
`data-testid`: todo selector acá abajo es texto de botón, atributo `title`,
o clase CSS. Ningún selector de este archivo está 100% garantizado sin
correrlo una vez — confirmalo en la primera corrida real de un flujo nuevo
y actualizá este archivo si cambió.

## Transversal / sidebar

- Tabs principales: `button.main-tab` (clase `main-tab active` cuando está
  seleccionado), texto exacto = "Chat" | "Terminal" | "Agent Flow" |
  "Workflows" | "Documents" | "Browser" | "Estudio".
  `packages/app-desktop/src/renderer/src/chat/MainTabs.tsx:131-135`.
  → usar el comando del driver `goto-tab <label>`.
- Secciones colapsables del sidebar (Projects/Sessions/Agents/Files/
  Complementos): header `button.collapsible-toggle` con
  `span.sidebar-label` (texto visible en mayúsculas vía CSS, el texto real
  del DOM NO está en mayúsculas — ej. literalmente "Projects", no
  "PROJECTS"). `components/CollapsibleSection.tsx:16`.
- Filas de proyecto/sesión en el sidebar: `button.session-item`. **Gotcha**:
  el texto nunca es un leaf puro (hay un dot de estado al lado) — hay que
  buscar TODOS los elementos con `textContent.trim() === nombre` y clickear
  el que tenga MENOS descendientes (`clickExactText` en `driver.mjs`, ya
  resuelto). Abrir un proyecto SIEMPRE spawnea una ventana Electron nueva
  — después de `open-project`/`new-project` hay que re-`windows`/`focus`.
- "Agents" sidebar: botón "+" es `button.icon-btn[title="Manage agents…"]`;
  link de pie "Manage agents" es `button.link-btn`.
  `chat/SessionSidebar.tsx:176-205,294-296`.

## Chat

- Input: `textarea` (única en la vista, placeholder "Type a message... (@
  to mention a file)"). Usar `pclick textarea` (click real de Playwright,
  NO `click` DOM — un `el.click()` sintético no mueve el foco real y el
  `type` posterior puede aterrizar en otro lado, como pasó hoy). El comando
  `send-chat <texto>` ya hace pclick+type+Send en un solo paso.
- Enviar: `button` con texto exacto "Send".
- Gate de aprobación: tarjeta con texto "Approval required — <tool>" y
  nivel ("MODERATE"/etc), botones `button` texto "Approve" / "Deny"
  (usar `click-text Approve` / `click-text Deny`).
- Sesión activa: sidebar "Sessions" → `button.session-item`, texto tipo
  `desktop:default:user-<uuid>` — reabrir una sesión existente (en vez de
  "+ New chat") es necesario para recuperar el historial si se reabrió la
  ventana del proyecto.

## Agent Flow

Fuente: `packages/app-desktop/src/renderer/src/agentFlow/`.

- Root: `div.agent-flow-view`. Toolbar `div.agent-flow-toolbar` →
  `button.agent-flow-toolbar-btn` por texto exacto: "+ New Agent Flow",
  "+ Add Node", "Save Flow" (→ "Saving…" mientras guarda), "Load into
  Terminal" (disabled sin nodos), "Save as Team…" (se convierte en
  `input.context-menu-input` al clickear, hay que tipear nombre + Enter).
- Selector de equipos: botón `button.main-tab-teams-select` ("Open Team"),
  dropdown `div.context-menu.teams-menu-list` → `button.context-menu-item`
  por equipo, borrar con `button.icon-btn[title="Delete team"]`.
- Confirmación de guardado: `span.mcp-status-ok` texto "Saved".
- Canvas: `div.agent-flow-canvas-area` → `div.agent-flow-team-label`
  (nombre del flow, sufijo "(unsaved)" si no hay team abierto); vacío =
  `div.agent-flow-canvas-empty` texto "No nodes yet…"; con nodos =
  `div.agent-flow-canvas` (React Flow: `.react-flow__node`,
  `.react-flow__edge`, `.react-flow__controls`).
- Nodo: `div.flow-node-compact` (+ `.selected`/`.running`), nombre
  `div.flow-node-compact-name`, eliminar `button.icon-btn[title="Remove
  node"]`. Click en el nodo abre el drawer de config.
- `NodeConfigDrawer` (`div.node-config-drawer`): nombre
  `input.flow-node-name`, harness `select`, para harness `yggdrasil` un
  `select` de agente + link "+ New agent"; para otros harnesses
  (`claude`/`antigravity`/`omp`/`copilot`) hay `textarea`/`input`/`select`
  de prompt/modelo/modo. Chips de rol: `button.agent-template-chip` (texto
  = nombre de rol, ej. "Backend Engineer"). Pie: `button` texto "Delete
  node".
- **Límite conocido**: conectar dos nodos con una edge requiere drag real
  (`page.mouse.move/down/move/up` sobre los handles `.react-flow__handle`),
  no clicks DOM — no automatizado todavía. "Load into Terminal" no
  depende de que existan edges, así que el flujo `agent-flow-team` no las
  necesita.

## Agents (gestión, modal "Manage agents")

Fuente: `packages/app-desktop/src/renderer/src/agents/AgentManager.tsx`.

- Modal: `div.modal-overlay` → `div.modal.agent-manager`, lista
  `ul.agent-list` → `li.agent-row` con editar
  (`button.icon-btn[title="Edit agent"]`) / borrar
  (`button.icon-btn[title="Delete agent"]`). Crear: `button.new-chat`
  texto "+ New agent".
- Form (`form.agent-form`): campos Id/Label (`input`), Role (`select`),
  Provider (`select`) + botón refresh, Model (`select`), System prompt
  (`textarea`), scope radios "Local to this project"/"Global (all
  projects)", botón "Save as custom role", pie "Cancel" / "Save agent"
  (submit).

## Workflows

(Ya validado extensamente en fases anteriores de esta sesión, backend +
mobile — selectores de UI desktop no relevados en detalle en esta ronda de
exploración; al escribir `workflows-crud.yaml` confirmar en vivo contra
`packages/app-desktop/src/renderer/src/workflows/` si existe un directorio
dedicado, mismo patrón de canvas @xyflow que Agent Flow.)

## Documents

Fuente: `packages/app-desktop/src/renderer/src/documents/DocumentsView.tsx`.

- Root: `div.documents-view` → `div.documents-tree` (árbol de archivos
  sobre `notes/`) + `div.documents-main`.
- Árbol (`../files/FileTree.tsx:208-216`): toolbar `button.icon-btn` con
  `title` "New file" / "New folder" / "Import files/folders…". Click en
  "New file" muestra `input.file-tree-new-input` (placeholder "file
  name") — tipear nombre + Enter crea el archivo y lo abre.
  Click en una entrada del árbol abre/activa su tab.
  **GOTCHA confirmado en vivo (2026-10-01)**: `FileTree` es el MISMO
  componente que usa la sección "Files" del sidebar (siempre presente en el
  DOM, aunque esté colapsada) — `document.querySelector('button.icon-btn
  [title="New file"]')` sin acotar matchea 2 elementos y Playwright/DOM
  toman el PRIMERO en orden del documento, que resultó ser el del sidebar
  (apunta a la raíz del proyecto), no el de Documents (apunta a `notes/`).
  Un archivo "creado" así termina en la raíz del proyecto, no en `notes/`
  — no es un bug de la app, es un selector ambiguo. SIEMPRE acotar con
  `.documents-tree button.icon-btn[title="New file"]` (o `.documents-tree
  ...` para cualquier botón de esta toolbar) al trabajar en el tab
  Documents.
- Tabs abiertas: `div.documents-tab` → `div.documents-tab-label` (botón,
  prefijo "● " si hay cambios sin guardar), `div.documents-tab-close`.
- Toolbar: `button.documents-drive-share-btn` texto "Compartir a Drive"
  (no usar en flujos QA — evitar tocar Drive real).
- Editor: `div.documents-editor` → `TextEditor` para archivos de texto, es
  un **Monaco Editor** real (`@monaco-editor/react`), NO un
  `contenteditable` simple ni CodeMirror. Selector del contenedor:
  `.monaco-editor`. **Confirmado en vivo (2026-10-01)**: hace falta un
  `pclick .monaco-editor` (click REAL de Playwright, no DOM) antes de
  `type` — Monaco solo enruta el teclado a su textarea interna tras un
  click real dentro del área; sin eso `type` no llega a ningún lado (el
  tab ni siquiera marca "sin guardar"). Después de eso, `type`/`press`
  normales andan bien. **Guardar es Cmd/Ctrl+S** (no hay botón "Save"
  visible) — usar `press Meta+KeyS` (macOS) o `press Control+KeyS`.
  Tab con cambios sin guardar: prefijo "●" antes del nombre (desaparece al
  guardar — confirmado).
- **Crear un archivo nuevo NO lo abre automáticamente** — aparece en el
  árbol pero hay que clickear la fila (`click-text <nombre>`) para abrirlo
  en un tab y recién ahí poder editarlo. Confirmado en vivo.
- Cerrar un tab con cambios sin guardar dispara
  `window.confirm('Discard unsaved changes to "<name>"?')` — un diálogo
  nativo del SO, no manejable por Playwright; evitar cerrar tabs sucios en
  los flujos, guardar siempre antes de navegar.

## Estudio

Fuente: `packages/app-desktop/src/renderer/src/studio/`.

- Root: `.studio-rail` (izquierda: `.studio-new-btn` texto "+ Nuevo",
  lista `.studio-rail-item` por plugin) + `.studio-main` (derecha).
- Crear (`StudioCreateForm.tsx`): clase `.studio-create-form`, campos
  nombre/id (input, id auto-slugificado)/icon (input), scope radios ("Este
  proyecto"/"Global"), checkboxes de vista ("Pestaña"/"Panel"), checkboxes
  de permisos (fs, fs:write, panes) + chip-adder de métodos gateway,
  descripción (`textarea`), submit `button[type=submit]` texto "Crear
  borrador".
- Workspace (`StudioWorkspace.tsx`): header `.studio-workspace-header`,
  toggle `.studio-mode-toggle` botones "Terminal"/"Chat" (clase `.active`
  en el seleccionado), `select.studio-harness-select` (opciones `claude` /
  `agy (Antigravity)`), botones "Publicar" (solo si es draft) y
  "Eliminar" (`.studio-danger-btn`, dispara `window.confirm` nativo).
- Preview (`StudioPreview.tsx`): `.studio-preview` → toolbar ("Vista
  previa" + botón "Recargar"), `iframe.plugin-frame` (sandboxed, SÍ
  alcanzable vía `querySelector`/`contentWindow` — a diferencia de
  Browser), `.studio-preview-log` (consola/errores del complemento).

## Browser

Fuente: `packages/app-desktop/src/renderer/src/browser/BrowserTabView.tsx`
+ `main/browserTabView.ts`.

- Chrome (SÍ en el DOM del renderer): `.browser-tab-bar` form →
  `input.browser-tab-address` (placeholder "Enter a URL…"), submit "Go",
  `button.browser-tab-pick-btn` (title "Click an element on the page to
  inspect it", texto "Pick element"/"Click an element…"). Placeholder sin
  URL: `.browser-tab-empty` texto "No page loaded — enter a URL above.".
  Resultado de un pick: `.browser-tab-picked` (`.browser-tab-picked-header`,
  `<strong>{selector}</strong>`, `.browser-tab-picked-text`,
  `.browser-tab-picked-html`).
- **Límite duro, no evitable con este driver**: el contenido navegado es
  un `WebContentsView` nativo de Electron (`main/browserTabView.ts:2,63`),
  compositado FUERA del árbol DOM del renderer — no es un `<iframe>` ni
  `<webview>`. `page.evaluate`/`querySelector` desde Playwright **nunca**
  lo va a ver ni poder interactuar con él. Solo se puede probar el chrome
  (navegación, que no crashee) — el contenido de la página requiere
  computer-use real o las tools MCP `browser_open`/`browser_pick_element`,
  no este driver.

## Terminal

No relevado en detalle esta ronda (xterm.js). Hipótesis a confirmar en la
primera corrida real de `terminal-basic.yaml`: la vista expone un
contenedor `.xterm` (o `.xterm-screen`) por pane; al enfocarlo (`pclick`
sobre ese contenedor) xterm.js enruta el teclado real a un textarea oculto
(`.xterm-helper-textarea`) que ya tiene foco, así que `type`/`press`
deberían funcionar igual que con cualquier input real. Si el contenedor
raíz tiene otro nombre de clase, corregir acá después de confirmarlo.
