# Slack Channel

Canal Slack en **Socket Mode** — no necesita URL pública ni tunneling.

## Prerequisitos

### 1. Crear Slack App

1. Ve a https://api.slack.com/apps → **Create New App** → **From scratch**
2. En **OAuth & Permissions** → **Bot Token Scopes**, añade:
   - `chat:write` — enviar mensajes
   - `channels:history` — leer mensajes en canales
   - `groups:history` — leer mensajes en canales privados
   - `im:history` — leer DMs
   - `mpim:history` — leer group DMs
3. En **Event Subscriptions** → **Subscribe to bot events**:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`
4. En **Socket Mode** → activar Socket Mode
5. En **App-Level Tokens** → **Generate Token** con scope `connections:write`
   - Guarda el token `xapp-...`
6. Instala la app en tu workspace → copia el Bot Token `xoxb-...`
7. Invita el bot al canal: `/invite @nombre-del-bot`

### 2. Tokens

| Token | Dónde obtenerlo | Uso |
|-------|----------------|-----|
| `xoxb-...` | OAuth & Permissions → Bot User OAuth Token | Autenticación + enviar mensajes |
| `xapp-...` | App-Level Tokens | Conexión Socket Mode |

## Configuración

### Via variables de entorno (recomendado para dev)

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_APP_TOKEN="xapp-..."
```

### Via config JSON

```json
{
  "channels": {
    "slack": {
      "accounts": {
        "default": {
          "botToken": "xoxb-...",
          "appToken": "xapp-...",
          "allowedChannelIds": ["C1234567890"]
        }
      }
    }
  },
  "plugins": {
    "installed": ["channel-slack"]
  }
}
```

`allowedChannelIds` es opcional. Si se omite, el bot responde en todos los canales donde está invitado.

## Instalación

```bash
yggdrasil plugin install @yggdrasil/channel-slack
yggdrasil tui
```

## Uso

Una vez iniciado, menciona al bot o escribe en el canal donde está invitado. El bot responde al final de cada turno (no streaming).

## Cómo funciona

- Conecta a Slack via **Socket Mode** (WebSocket hacia Slack — no expone puerto)
- Recibe `message` events filtrados (ignora bots, edits, joins)
- `sessionKey = slack:default:<channelId>` — una sesión por canal Slack
- Respuestas en chunks de 3000 chars (Slack soporta 40k pero es mejor segmentar)
