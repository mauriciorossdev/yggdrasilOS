# TL-07 — Cron / Scheduling

**Status:** ✅ Implementado  
**Plugin:** `extensions/service-cron`

## Objetivo

Disparar mensajes al pipeline en horarios predefinidos (cron expressions). Permite briefings diarios, recordatorios, tareas periódicas, etc.

## Arquitectura

Plugin de kind `service` — no es channel ni tool. Se inicia con el kernel (`startKernel()`).

El service importa `runChannelTurn` de `@yggdrasil/pipeline` directamente y `getKernelContext` de `@yggdrasil/kernel` para obtener `workspaceRoot`.

Dependencia externa: `node-cron` v3 (ESM compatible).

## Config

```json
{
  "pluginConfig": {
    "service-cron": {
      "jobs": [
        {
          "id": "daily-briefing",
          "expression": "0 8 * * *",
          "message": "Dame el resumen del día: fecha, tareas pendientes, recordatorios.",
          "sessionKey": "tui:default:user",
          "timezone": "America/Mexico_City",
          "enabled": true
        }
      ]
    }
  }
}
```

### Campos de job

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `id` | string | — | Identificador único del job |
| `expression` | string | — | Cron expression (5 campos: min hora día mes dow) |
| `message` | string | — | Mensaje a inyectar en el pipeline |
| `sessionKey` | string | — | Sesión destino (`channelId:accountId:senderId`) |
| `timezone` | string | — | IANA timezone (ej. `America/Mexico_City`) |
| `enabled` | boolean | `true` | `false` para deshabilitar sin borrar |

## Flujo

```
startKernel()
  → service-cron.start()
    → lee pluginConfig["service-cron"].jobs
    → cron.schedule(expression, callback)
      → callback dispara runChannelTurn({ message, config })
        → pipeline procesa → respuesta va al canal de la sessionKey
```

## sessionKey destino

El `sessionKey` determina en qué sesión/canal aparece la respuesta del agente. Para que la respuesta llegue al usuario, el canal de la sesión debe estar corriendo:

- `tui:default:user` → aparece en channel-tui (readline)
- `http:default:user` → aparece en HTTP channel
- `discord:default:CHANNEL_ID` → el bot responde en ese canal de Discord

Si el canal no está activo, la respuesta se genera pero no se entrega.
