# Sessions — memoria, compaction y edición

Yggdrasil persiste conversaciones en `~/.yggdrasil/sessions` (configurable con `sessions.dir`). Esta guía cubre compaction, límites por tokens, historial con tools y RPC del gateway.

## Configuración

```json
{
  "sessions": {
    "maxMessages": 50,
    "compactThreshold": 40,
    "compactionPolicy": "summarize",
    "maxTokens": 12000
  },
  "harness": {
    "compactBeforeTurn": true
  }
}
```

| Campo | Default | Descripción |
|-------|---------|-------------|
| `maxMessages` | `50` | Límite duro de mensajes en disco (post-compaction) |
| `compactThreshold` | `40` | Dispara compaction automática al alcanzar este conteo |
| `compactionPolicy` | `summarize` | `summarize` (LLM) o `truncate` (mantener últimos N) |
| `maxTokens` | — | Recorte preventivo del historial enviado al harness (heurística chars/4) |
| `compactBeforeTurn` | `true` | Si `false`, desactiva compaction pre-turn |

Si no hay API key del provider, `summarize` hace fallback a `truncate`.

## Historial con tools

Tras un tool call, el pipeline persiste en disco:

1. Mensaje `assistant` con `tool_calls`
2. Mensajes `tool` con `tool_call_id` y resultado
3. Respuesta final `assistant` (texto)

Consulta vía gateway:

```json
{ "method": "sessions.get", "params": { "sessionKey": "tui:default:local-user" } }
```

## Gateway RPC

### `sessions.patch`

Actualiza metadata de una sesión sin borrar mensajes:

```json
{
  "method": "sessions.patch",
  "params": {
    "sessionKey": "tui:default:local-user",
    "title": "Pruebas tools",
    "agentId": "default",
    "metadata": { "topic": "demo" }
  }
}
```

### `tools.list`

Lista tools registradas (builtin + plugins) sin invocar al LLM:

```json
{ "method": "tools.list", "params": {} }
```

Respuesta: `{ "tools": [{ "name", "description", "parameters" }, ...] }`

### `health`

Incluye `version: "0.4.0"` y `pluginApi` alineado con el SDK.

## Compaction

Antes de cada turn (si `compactBeforeTurn`):

1. Se cuenta el historial en disco
2. Si `count >= compactThreshold`, se compacta:
   - **summarize**: resume mensajes antiguos en un bloque `system` `[Resumen previo] …` y conserva los últimos 10 intactos
   - **truncate**: conserva solo los últimos 10 mensajes
3. Si `maxTokens` está definido, se recorta el historial enviado al harness

El estado de compaction se guarda en `session.compaction` (`lastCompactedAt`, `summarizedThroughIndex`).

## Demo manual

```bash
pnpm build
node packages/cli/dist/index.js gateway
```

Compaction: envía 45+ mensajes en TUI o vía `chat.send` repetido; verifica que `sessions.get` muestra `compaction` y que el agente sigue respondiendo.

Tool persistence:

```bash
export OLLAMA_API_KEY=...
node packages/cli/dist/index.js tui
# > usa my-tool_echo con message "hola"
# Luego sessions.get → historial con tool_calls + tool
```

## Ver también

- [Crear plugins](./creating-plugins.md)
- [Configuración del provider](./provider-config.md)
- [Roadmap](./roadmap-iteraciones.md)
