---
name: qa-flow-suite
description: >
  Crea y corre pruebas E2E en vivo contra la app desktop real de Yggdrasil
  (packages/app-desktop), usando un driver Playwright que controla la app
  Electron de verdad sobre un proyecto de QA fijo y descartable. Usar
  cuando el usuario pida "probar" un flujo o tab de la app (Chat, Terminal,
  Workflows, Agent Flow, Documents, Browser, Estudio, creación de
  proyectos), "correr la suite/flujo de X", "armar una prueba nueva para
  Y", o cualquier variante de "qa flow" / testear la app en vivo. También
  dispara si se pide revisar si un bug encontrado antes (ver findings.md)
  sigue pasando.
---

# QA flow suite — probar la app desktop en vivo

Esto NO es una suite headless con pass/fail automático. Cada flujo es un
YAML con pasos de `action` (deterministas, los corre el driver) y
`checkpoint` (vos, el agente, mirás pantalla/disco/red y juzgás). Esa
mezcla es a propósito: el 2026-10-01 encontramos un bug real (el chat
afirmaba que un `npm run dev` quedó corriendo en background cuando en
realidad el proceso ya había muerto) que un assert de texto rígido jamás
hubiera atrapado — solo salió porque alguien verificó contra la realidad.
Un checkpoint nunca se "da por bueno" sin esa verificación cuando el paso
lo amerita.

Todo el tooling vive **fuera del repo**, en
`<workspace>/ygg-qa-tooling/` (sibling de
`harness_pp`) — mismo patrón que `ygg-qa-project` (el proyecto de prueba
fijo). Leé `ygg-qa-tooling/README.md` si no lo tenés fresco en memoria.

## Correr un flujo existente

1. Elegí el flujo pedido en `ygg-qa-tooling/flows/<id>.yaml` (si el
   usuario no especifica cuál, preguntale o listá los disponibles — NO
   corras los 8 de una, el usuario pidió explícitamente "solo el flujo que
   desee probar").
2. Si el driver no está corriendo: `tmux new-session -d -s ygg-qa -x 220 -y
   50 "node driver.mjs"` desde `ygg-qa-tooling/`, después `tmux send-keys
   -t ygg-qa "launch" Enter` y esperar ~8s.
3. Andá leyendo el YAML paso a paso. Cada `action: <cmd>` / `arg: <valor>`
   se manda como `tmux send-keys -t ygg-qa "<cmd> <valor>" Enter`, esperás
   1-2s, `tmux capture-pane -t ygg-qa -p` para ver el `{"ok":...}` de
   respuesta (capturá el pane COMPLETO, no uses `| tail -N` — el pane tiene
   alto fijo y las líneas en blanco de relleno rompen el tail, ver
   gotcha en el README).
4. En cada `checkpoint`, PARÁ. Sacá un `ss <nombre>` si el paso previo no
   lo hizo, leé el PNG con el tool `Read`, y respondé la pregunta del
   checkpoint con evidencia real — si dice "verificá contra disco/red",
   salí a Bash de verdad (curl, ps, ls, cat) en vez de confiar en lo que
   muestra la UI. Recién ahí seguís al siguiente paso.
5. Si algo no cuadra, anotalo en `ygg-qa-tooling/findings.md` (mismo
   formato que las entradas existentes: repro, resultado esperado vs real,
   causa probable si se puede inferir, por qué importa).
6. Al terminar, resumí en 2-3 líneas qué se validó y qué no al usuario —
   no hace falta un reporte largo salvo que haya hallazgos nuevos.

Comandos del driver disponibles (ver `driver.mjs` para el detalle):
`launch`, `windows`, `focus <i>`, `open-project <nombre>`, `new-project
<nombre>`, `goto-tab <label>`, `send-chat <texto>`, `wait-for-text
<segundos> <texto>`, `click <selector>`, `pclick <selector>`, `click-text
<texto>`, `type <texto>`, `press <tecla>`, `wait <selector>`, `text
<selector>`, `html <selector>`, `eval <js>`, `ss <nombre>`, `close`.

## Crear un flujo nuevo

1. Copiá `references/flow-template.yaml` (en esta misma carpeta de la
   skill) a `ygg-qa-tooling/flows/<id>.yaml`.
2. Consultá `references/selectors.md` para los selectores del tab en
   cuestión. Si falta algo o cambió (la app evoluciona, esto no es
   infalible), investigá el renderer source
   (`packages/app-desktop/src/renderer/src/...`) igual que se hizo para
   armar el catálogo inicial, y ACTUALIZÁ `selectors.md` — así la próxima
   sesión no tiene que repetir el trabajo.
3. Escribí los pasos usando solo el vocabulario de comandos ya existente
   en el driver (arriba). Si de verdad hace falta un comando genérico
   nuevo (se repetiría en 3+ flujos), agregalo a `driver.mjs` siguiendo el
   patrón de los que ya están — no inventes un verbo de un solo uso por
   feature, eso infla la superficie sin necesidad.
4. Corré el flujo una vez en vivo para validarlo (paso a paso, como en la
   sección anterior) antes de darlo por terminado — un YAML sin correr es
   solo una hipótesis.

## Reglas estándar (heredadas de esta sesión, no negociables)

- Nunca apuntar un flujo a un proyecto real del usuario — solo
  `ygg-qa-project` o algo creado con `new-project` (vive en
  `ygg-qa-tooling/scratch-projects/`, descartable).
- Antes de un paso pesado (`npm install`, builds grandes), chequeá espacio
  en disco (`df -h /`) — ya rompió un comando una vez por ENOSPC.
- `new-project` no ejercita el diálogo nativo real de "Nuevo proyecto"
  (Playwright no puede manejar diálogos de archivo del SO sin computer-use
  real) — es una limitación conocida, no la reportes como bug.
- El tab Browser solo es testeable en su chrome (address bar, botones); el
  contenido de la página navegada es un `WebContentsView` nativo fuera del
  DOM del renderer, inalcanzable por este driver — no es un bug, está
  documentado en `selectors.md`.
- "No hagas nada destructivo" sigue aplicando siempre: nunca borrar/forzar
  nada fuera del alcance de `ygg-qa-project`/`scratch-projects/` sin que el
  usuario lo pida explícitamente.
