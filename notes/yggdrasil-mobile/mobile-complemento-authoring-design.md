# Crear complementos desde el chat del teléfono — pendiente de revisar

## Contexto

El viewer de complementos en mobile (`mobile/app/lib/plugins/`) ya está
hecho y probado en el Samsung: lee/renderiza complementos cuyo manifest
declara `views: ["mobile"]`, vía las mismas `fs.list`/`fs.read` del
gateway que ya usa desktop (`packages/app-desktop/src/main/plugins.ts`).

La pregunta pendiente era: ¿se puede *crear* un complemento pidiéndoselo
al agente desde el chat del teléfono, igual que ya se puede desde el chat
de desktop? Se investigó y la respuesta real es más matizada de lo que se
asumió al diseñar el viewer.

## Qué se verificó

- `scaffold_plugin`/`list_plugins`/etc. viven **solo** en el `.mcp.json`
  del proyecto (`packages/app-desktop/src/main/mcpConfig.ts:84-105`,
  `writePluginsMcpConfig`) — un archivo que **únicamente los binarios CLI
  `claude`/`agy`** cargan automáticamente al spawnear una terminal.
- El tool-loop de `chat.send` (el que atiende tanto el chat de desktop
  como el del teléfono — `packages/gateway/src/methods.ts:1771` →
  `runChannelTurn` → `pipeline/src/turn-kernel.ts:200`
  `selection.harness.runAttempt(...)`) **no recibe ningún `tools` desde
  ahí** — su registry sale entero del **registry global del kernel**,
  poblado al arrancar el gateway por cada plugin `tool-*` vía
  `api.registerTool(...)`. `tool-mcp/src/index.ts:26` sí carga servers
  MCP, pero desde `config.mcpServers` (la config del propio gateway), **no**
  desde `.mcp.json` del proyecto — son dos almacenes distintos, nada los
  puentea.
- Conclusión: **`chat.send` no tiene `scaffold_plugin` directo.** La
  suposición original al escribir el plan del viewer mobile ("ya funciona
  sin cambios") era incorrecta tal como estaba formulada.

## El camino que sí existe hoy

`tool-cli-delegate/src/index.ts` registra `invoke_cli`
(`invoke-cli-tool.ts:59`) como tool **global del kernel** — disponible en
cualquier turno de chat.send, cualquier cliente. Corre
`claude -p --output-format json --permission-prompts none <task>` en modo
headless, con cwd en la raíz del proyecto — ese proceso sí carga
`.mcp.json` y sí tiene `scaffold_plugin` disponible. Pasa por el mismo
approval-gate que cualquier otro tool (moderate/destructive).

**Entonces hoy, pedirle al chat del teléfono "créame un complemento
que..." puede funcionar** — pero de forma indirecta: el modelo de chat
tiene que elegir delegar vía `invoke_cli` en lugar de responder que no
puede. No está garantizado — depende de qué tan bien el agente de chat
activo elige ese tool para esa tarea. Sin verificar todavía: si el agente
**default** del chat (Ollama local, según memoria del proyecto — "Default
Agent = Ollama/gemma4:e4b, Chat tab only") es siquiera capaz de elegir
`invoke_cli` de forma confiable para esto, o si hace falta un modelo más
capaz (Claude vía API) configurado en ese chat para que esto sea
confiable.

## Alternativa más sólida (no implementada, para evaluar)

Exponer `scaffold_plugin`/`list_plugins`/`reload_plugin`/`open_plugin`
como **tool nativo del gateway** (registrado en el kernel global, mismo
patrón que `panes`/`documents`/`memory` ya tienen) en lugar de vivir solo
en `.mcp.json`. Eso le daría acceso directo y confiable a **cualquier**
chat — celular o desktop, cualquier modelo activo — sin depender de que
el agente elija delegar correctamente vía `invoke_cli`.

Trade-off a decidir cuando se retome: esto duplicaría parcialmente la
superficie que hoy solo expone `pluginsControlMcpShim.ts` a terminales, o
habría que unificar ambos caminos (terminal vía `.mcp.json` + chat vía
tool nativo) para que no diverjan con el tiempo.

## Próximo paso cuando se retome

1. Probar en la práctica: pedir "créame un complemento de prueba" desde
   el chat del teléfono con el agente default actual, ver si realmente
   delega vía `invoke_cli` y el complemento aparece en
   `.yggdrasil/plugins/`.
2. Si no es confiable, decidir entre (a) cambiar el agente default del
   chat a uno con mejor tool-selection, o (b) construir la alternativa de
   tool nativo descrita arriba.
