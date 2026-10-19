# Telegram channel

Conecta Yggdrasil a un bot de Telegram vía **long polling** (no requiere URL pública).

## 1. Crear el bot

1. Abre [@BotFather](https://t.me/BotFather) en Telegram
2. `/newbot` → guarda el **token**
3. Exporta el token:

```bash
export TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
```

## 2. Configuración

En `yggdrasil.config.json`:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "default": {
          "botToken": "YOUR_TOKEN",
          "pollingIntervalMs": 1000,
          "allowedChatIds": []
        }
      }
    }
  }
}
```

O usa solo la variable de entorno `TELEGRAM_BOT_TOKEN` (sin poner el token en el archivo).

## 3. Arrancar

```bash
pnpm build
export OLLAMA_API_KEY=...   # si usas LLM
node packages/cli/dist/index.js run
```

Envía un mensaje al bot en Telegram. La respuesta usa el mismo pipeline que TUI/HTTP.

## sessionKey

Cada chat de Telegram mapea a:

```
telegram:default:<chatId>
```

Ejemplo: `telegram:default:123456789`

Puedes inspeccionar la sesión vía gateway:

```json
{ "method": "sessions.get", "params": { "sessionKey": "telegram:default:CHAT_ID" } }
```

## Auth (iteración 5)

Si configuraste `auth.gateway.apiKey` o `auth.http.apiKey`, el gateway WebSocket y HTTP también requieren token. Ver [testing.md](./testing.md).

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Bot no responde | Verifica `TELEGRAM_BOT_TOKEN` y `channels.telegram.enabled: true` |
| 401 en HTTP | Añade `Authorization: Bearer <YGGDRASIL_API_KEY>` |
| Mensajes ignorados | Revisa `allowedChatIds` si está configurado |
| Polling lento | Ajusta `pollingIntervalMs` |

## Webhook (futuro)

Long polling es el MVP. Para webhook necesitas HTTPS público y `setWebhook` — documentación pendiente para iteración futura.

## Ver también

- [creating-plugins.md](./creating-plugins.md)
- [testing.md](./testing.md)
- Plugin: `extensions/channel-telegram/`
