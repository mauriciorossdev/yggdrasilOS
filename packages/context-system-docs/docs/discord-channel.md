# Discord channel

Conecta Yggdrasil a un bot de Discord vía **Gateway WebSocket** (discord.js v14).  
Cada canal de texto de Discord es una sesión independiente.

## 1. Crear el bot

1. Ve a [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → dale un nombre
3. Sección **Bot** → **Add Bot** → copia el **Token**
4. En la sección **Bot**, activa el intent privilegiado:
   - ✅ **MESSAGE CONTENT INTENT** (obligatorio — sin esto el bot no lee el texto)
5. Sección **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages` + `Read Message History` + `View Channels`
6. Copia la URL generada, ábrela en el navegador e invita el bot al servidor

## 2. Configuración

En `yggdrasil.config.json`:

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "accounts": {
        "default": {
          "botToken": "TU_TOKEN_AQUI",
          "allowedChannelIds": [],
          "prefix": ""
        }
      }
    }
  }
}
```

O usa variable de entorno (sin token en el archivo):

```bash
export DISCORD_BOT_TOKEN=TU_TOKEN_AQUI
```

### Opciones de cuenta

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `botToken` | `string` | — | Token del bot. Alternativa: `DISCORD_BOT_TOKEN` env |
| `allowedChannelIds` | `string[]` | `[]` | IDs de canales permitidos. Vacío = todos |
| `prefix` | `string` | `""` | Prefijo requerido (ej `"!"`). Vacío = responde a todo |

## 3. Arrancar

```bash
pnpm build
node packages/cli/dist/index.js run
```

Escribe un mensaje en cualquier canal donde esté el bot. Responde usando el mismo pipeline que TUI/HTTP.

## sessionKey

Cada canal de Discord mapea a:

```
discord:default:<channelId>
```

Ejemplo: `discord:default:1234567890123456789`

Inspeccionar sesión vía gateway:

```json
{ "method": "sessions.get", "params": { "sessionKey": "discord:default:CHANNEL_ID" } }
```

## Límites

- Mensajes >2000 caracteres se dividen automáticamente (límite de la API de Discord)
- Split preferentemente en saltos de línea
- Sin streaming — Discord no soporta edición incremental; la respuesta llega completa

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Bot conecta pero no lee mensajes | Activar **MESSAGE CONTENT INTENT** en Developer Portal |
| `Error: Used disallowed intents` | Igual — falta el intent privilegiado |
| Bot no responde a algunos canales | Revisa `allowedChannelIds` o permisos del bot en ese canal |
| Token inválido | Regenera el token en Developer Portal → Bot |

## Ver también

- [telegram-channel.md](./telegram-channel.md)
- [creating-plugins.md](./creating-plugins.md)
- Plugin: `extensions/channel-discord/`
