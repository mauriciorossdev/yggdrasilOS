# Cron Scheduler service

Plugin `@yggdrasil/service-cron` — dispara mensajes al pipeline según expresiones cron.  
Sin setup adicional — solo configurar jobs en `yggdrasil.config.json`.

## Configuración

```json
{
  "pluginConfig": {
    "service-cron": {
      "jobs": [
        {
          "id": "daily-briefing",
          "expression": "0 8 * * *",
          "message": "Dame el resumen del día: fecha, tareas pendientes, clima.",
          "sessionKey": "tui:default:user",
          "timezone": "America/Mexico_City"
        },
        {
          "id": "hourly-check",
          "expression": "0 * * * *",
          "message": "¿Hay algo pendiente en las últimas horas?",
          "sessionKey": "discord:default:1234567890",
          "enabled": false
        }
      ]
    }
  }
}
```

### Campos

| Campo | Requerido | Descripción |
|-------|-----------|-------------|
| `id` | Sí | Nombre único del job |
| `expression` | Sí | Cron expression (5 campos) |
| `message` | Sí | Texto que se envía al agente |
| `sessionKey` | Sí | Sesión destino (ver abajo) |
| `timezone` | No | IANA timezone. Default: sistema |
| `enabled` | No | `false` para pausar sin borrar. Default: `true` |

## Cron expressions

```
┌─ minuto (0-59)
│  ┌─ hora (0-23)
│  │  ┌─ día del mes (1-31)
│  │  │  ┌─ mes (1-12)
│  │  │  │  ┌─ día de la semana (0-7, 0=domingo)
│  │  │  │  │
*  *  *  *  *
```

| Expression | Cuándo |
|------------|--------|
| `0 8 * * *` | Todos los días a las 8:00 |
| `0 8 * * 1-5` | Lunes a viernes a las 8:00 |
| `*/30 * * * *` | Cada 30 minutos |
| `0 9 1 * *` | Primer día de cada mes a las 9:00 |
| `0 20 * * 5` | Viernes a las 20:00 |

## sessionKey destino

El `sessionKey` define en qué sesión aparece la respuesta del agente:

| sessionKey | Destino |
|------------|---------|
| `tui:default:user` | Channel-TUI (readline) |
| `discord:default:CHANNEL_ID` | Bot responde en ese canal de Discord |
| `telegram:default:CHAT_ID` | Bot responde en ese chat de Telegram |
| `http:default:user` | HTTP channel (solo si hay cliente conectado) |

**Importante:** el canal debe estar corriendo. Si Discord o Telegram no están activos, la respuesta se procesa pero no se entrega.

## Cómo funciona

El service arranca con el gateway (`yggdrasil run`). Para cada job habilitado, registra un cron task. Cuando dispara, inyecta el `message` en la sesión `sessionKey` como si fuera un mensaje del usuario — el pipeline lo procesa y la respuesta va al canal correspondiente.

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Job no dispara | Verificar cron expression con [crontab.guru](https://crontab.guru) |
| `invalid cron expression` en log | Expression inválida — revisar sintaxis |
| Respuesta no llega al canal | Verificar que el canal esté activo (`yggdrasil run`) |
| Timezone incorrecta | Usar nombre IANA exacto (ej. `America/Mexico_City`, no `CST`) |

## Ver también

- Plugin: `extensions/service-cron/`
- Roadmap: `docs/plans/TL-07-cron.md`
