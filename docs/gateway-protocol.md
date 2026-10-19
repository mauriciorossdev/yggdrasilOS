# Protocolo del Gateway (contrato para clientes externos)

Referencia genérica del protocolo WebSocket RPC del gateway de Yggdrasil,
pensada para clientes que **no** viven en este monorepo (apps móviles,
scripts, integraciones de terceros). Los clientes internos (`app-tui`,
`app-voice`, `web-console`) ya lo implementan — usar
`packages/web-console/src/api/gateway-client.ts` como referencia de
implementación si hace falta.

## Transporte

Un único WebSocket a `ws://<host>:<port>/` (o `wss://` si hay TLS
configurado, ver [TLS Gateway](./tls-gateway.md)).

- Host/puerto por defecto: `127.0.0.1:18789` (`gateway.host` / `gateway.port`
  en la config).
- No hay endpoints REST además del WS (salvo `GET /` que devuelve
  `{ ok: true, service: "yggdrasil-gateway", ui: "/ui" }`, y `/ui` que sirve
  la web console).

## Envelope de mensajes

**Request** (cliente → gateway):
```json
{ "id": 1, "method": "chat.send", "params": { "message": "hola" } }
```

**Response** (gateway → cliente, mismo `id`):
```json
{ "id": 1, "result": { "sessionKey": "...", "reply": "...", "harnessId": "..." } }
```
o en error:
```json
{ "id": 1, "error": { "code": "METHOD_NOT_FOUND", "message": "..." } }
```

**Evento push** (gateway → cliente, sin `id` — para streaming y notificaciones):
```json
{ "type": "event", "event": "chat.delta", "payload": { "sessionKey": "...", "text": "...", "partial": true } }
```

Eventos disponibles: `chat.delta`, `chat.final`, `tool.approval.requested`,
`tool.approval.resolved`, `turn.start`, `turn.end`, `tool.execute`,
`provider.latency`. Todos los clientes conectados reciben todos los eventos
del proceso — filtrar por `payload.sessionKey` del lado del cliente.

## Autenticación

Si `auth.gateway.required` está activo (o hay `apiKey`/`apiKeys`
configuradas — ver [API Keys Gateway](./api-keys.md)), la conexión arranca
sin autenticar. Dos formas de autenticar:

1. **Query param al conectar** (más simple para clientes no-browser):
   `ws://host:puerto/?apiKey=<key>`.
2. **Primer mensaje** después de conectar:
   ```json
   { "id": 0, "method": "auth", "params": { "apiKey": "<key>" } }
   ```
   Responde `{ "id": 0, "result": { "ok": true } }` si es válida.

Mientras no esté autenticado, cualquier otro método devuelve
`{ error: { code: "UNAUTHORIZED", ... } }`.

## Métodos principales

| Método | Params | Devuelve | Notas |
|---|---|---|---|
| `health` | — | `{ ok, version, authRequired, features }` | Para chequear conectividad y si hace falta auth |
| `agents.list` | — | `{ agents, defaultAgent }` | |
| `providers.list` | — | `{ providers: [{ id, label, models }] }` | |
| `chat.send` | `{ message, sessionKey?, agentId?, channelId?, senderId? }` | `{ sessionKey, reply, harnessId, usage }` | Dispara `chat.delta`/`chat.final` por el mismo socket durante la ejecución. Si no se pasa `sessionKey`, se genera uno nuevo. |
| `sessions.list` | — | `{ sessions: SessionSummary[] }` | |
| `sessions.get` | `{ sessionKey }` | `{ session: SessionRecord \| null }` | |
| `sessions.patch` | `{ sessionKey, title?, metadata?, agentId? }` | `{ session }` | Renombrar, etc. |
| `sessions.reset` | `{ sessionKey }` | `{ reset: true, sessionKey }` | Borra historial de esa sesión |
| `sessions.compact` | `{ sessionKey, agentId? }` | resultado de compaction | |
| `tools.list` | — | `{ tools }` | |
| `tools.approve` | `{ requestId, approved }` | `{ ok, requestId, approved }` | Responder a `tool.approval.requested` |
| `config.get` | — | `{ config, workspaceRoot, configPath }` | Config saneada (sin secretos) |
| `config.patch` | patch parcial (whitelist) | `{ ok, requiresRestart, config }` | |

### Forma de `SessionRecord` / `SessionSummary`

```ts
type SessionSummary = { sessionKey, title?, agentId?, messageCount, createdAt, updatedAt };
type SessionRecord = { sessionKey, title?, agentId?, messages: (ChatMessage & { timestamp })[], createdAt, updatedAt, metadata? };
```

## Streaming de una respuesta (patrón recomendado para un cliente)

1. Enviar `chat.send` con un `id` conocido.
2. Escuchar eventos `chat.delta` con `payload.sessionKey === sessionKey` para
   ir pintando texto parcial.
3. La respuesta a la request (`{ id, result }`) y el evento `chat.final`
   traen el texto completo — usar el que llegue primero, son equivalentes.

## Ver también

- [Web Console](./web-console.md) — cliente de referencia (browser)
- [API Keys Gateway](./api-keys.md) — múltiples keys, expiración
- [TLS Gateway](./tls-gateway.md) — acceso remoto seguro (WSS)
- [Sesiones y memoria](./sessions.md) — detalle de compaction y tools en historial
