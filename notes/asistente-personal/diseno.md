# Asistente personal persistente (mobile + gateway en Railway)

Estado: **IMPLEMENTADO** (las 7 fases). Última actualización: 2026-10-08. Rama `feat/assistant`.

## Objetivo

Un único chat con un agente asistente en la app mobile, con memoria y contexto continuos. Recibe documentos, lee el calendario, usa las tools del teléfono y puede escribirte primero (recordatorios por push). El orquestador vive en un gateway en Railway; el modelo es Claude Haiku 4.5 por la API de Anthropic (intercambiable por dispositivo: Sonnet 5.5 / Opus 5.5).

## Arquitectura final

```
Mobile (Flutter, com.mauriciorossdev.yggdrasil)
  ├─ ejecuta phone_* tools (calendario, alarmas, SMS, archivos…)
  ├─ sube documentos, ve/edita memoria, ajustes, TTS
  └─ recibe push (FCM) y abre el chat al tocarlos
        │  WebSocket JSON-RPC (wss, API key)
        ▼
Gateway en Railway (volumen /data, workspace /data/project)
  ├─ agente "assistant" (provider anthropic, haiku-4-5, prompt largo con caché)
  ├─ sesión única assistant:main + compactación automática
  ├─ memoria durable (context-memory-db, sqlite en el volumen)
  ├─ documentos (notes/assistant) + read_document
  ├─ recordatorios + scheduler (15 s) + push FCM (HTTP v1, sin firebase-admin)
  ├─ cola offline de acciones del teléfono (se vacía al reconectar)
  └─ TTS: Replicate / MiniMax speech-2.8-turbo
```

## Fases (todas hechas)

| # | Fase | Resultado |
|---|---|---|
| 1 | Provider Anthropic | `packages/provider-anthropic` (Messages API, streaming, tool use, **prompt caching**). Probado en vivo |
| 2 | Sesión única + inicio | `assistant:main` + pantalla de inicio con botón central (`mobile/app/lib/assistant/`) |
| 3 | Memoria durable | `memory-db` como proveedor de contexto + tools `memory_*`; pantalla "Memoria del asistente" |
| 4 | Documentos | `documents.upload/list/delete` (por trozos, 25 MB), `read_document` con `offset`, pantalla "Documentos adjuntos", clip en el composer |
| 5 | Railway | Servicio `gateway` en el proyecto `yggdrasil-assistant`, volumen `/data` |
| 6 | Calendario | `phone_read_calendar` (CalendarContract.Instances; eventos recurrentes expandidos) |
| 7 | Push + cola | FCM, `reminder_*`, cola offline, token por dispositivo |

Extras fuera del plan inicial: chip de uso/costo y selector de modelo, tokens por respuesta (con caché), TTS, reconexión automática del WebSocket, historial limpio (sin mensajes internos de tools), lista de tools permitidas por agente.

## Burbuja de acceso rápido (Android)

Burbuja flotante sobre cualquier app (permiso "Mostrar sobre otras apps"), activable en Ajustes del asistente. Toque = abre el chat (`yggdrasil://assistant`). Mantener = menú **Hablar / Abrir chat / Escribir**; mantener 3 s = modo voz directo (un arco dorado se llena mientras tanto). La respuesta es **solo voz**: nada de la conversación se dibuja.

- **Nativo** (`mobile/app/android/.../yggdrasil/`): `BubbleService` (servicio en primer plano `specialUse`, ventanas `TYPE_APPLICATION_OVERLAY`, arrastre con snap a borde, posición persistida, vuelve tras reinicio y al abrir la app), `BubbleView` (disco + estados), `VoiceCaptureActivity` (actividad translúcida que escucha una frase con `SpeechRecognizer`; Android solo garantiza el micrófono a algo en primer plano), `PermissionRequestActivity` (diálogo de permisos para el motor sin pantalla), `BackgroundDeviceTools` (canal `device_tools` sin Activity).
- **Cerebro**: motor Flutter headless perezoso (`BubbleBrain`, entrypoint Dart `bubbleAssistantMain`, se destruye tras 5 min de inactividad). `BubbleAssistantSession` abre su propia conexión al gateway (mismo `deviceId`), manda `chat.send` a `assistant:main`, espera `chat.final` y habla con `AssistantTts`. Respaldo: voz de Android si falla la nube.
- **Gateway**: `device.tool.invoke.requested` y su cancelación se entregan **solo a la conexión dueña** (`deviceRouting.ts`). Antes se difundían a todas: con la app y la burbuja a la vez, cada tool (alarma, SMS) se habría ejecutado dos veces.
- **Aprobaciones**: auto-aprobar si está activo; si no, tarjeta nativa Aprobar/Rechazar (45 s y se rechaza sola).
- **Voz**: el chat solo lee en voz alta las respuestas de turnos que él mismo inició (más recordatorios), para no hablar a la vez que la burbuja.

Lecciones: `onPlayerComplete.first.timeout(onTimeout: () {})` lanzaba un TypeError tras empezar a reproducir, y la burbuja activaba el respaldo de voz encima (dos voces); y un motor sin pantalla no tiene los canales nativos de `MainActivity` ni puede pedir permisos, por eso existen `BackgroundDeviceTools` y `PermissionRequestActivity`.

Límites: la voz por burbuja no suma al chip de uso/costo (otro proceso); Samsung puede matar el servicio por ahorro de batería; las tools interactivas (selector de archivos) no funcionan sin pantalla.

## Decisiones tomadas

- Tools del teléfono con la app cerrada: **cola simple** para acciones "para más tarde"; lecturas fallan.
- Calendario: del **dispositivo** (Google queda para después).
- Sin cifrado en reposo. Compactación con el mismo modelo (Haiku).
- Push con FCM; standalone (sin gateway) se mantiene como fallback.
- UI: botón redondo central que abre el chat main.
- Tool search de Anthropic (`defer_loading`) **descartado** con Haiku: 6/8 aciertos y más caro que las tools completas cacheadas.

## Componentes y detalles que importan

### Agente y prompt (`deploy/railway/project-template/yggdrasil.config.json`)
- `provider: anthropic`, `model: claude-haiku-4-5-20251001`, `contextProviders: ["memory-db"]`.
- `tools.allow`: `phone_*`, `memory_*`, `read_document`, `list_documents`, `reminder_*`. Sin esto, el agente heredaría `run_command`, `write_file`… (el campo `AgentConfig.tools.allow` lo añadimos en `packages/config`).
- El **system prompt es largo a propósito**: Haiku 4.5 solo cachea prefijos ≥ **4.096 tokens**; con las 27 tools reales el prefijo era 3.703. Si se recortan tools o el prompt y cae bajo ese umbral, la caché deja de actuar sin avisar.
- El entrypoint **resincroniza la config desde la plantilla en cada arranque** (`YGGDRASIL_KEEP_CONFIG=1` lo desactiva).

### Prompt caching
`cache_control` en la última tool, el system prompt y el último mensaje. Medido: 1.er mensaje escribe ~4.7k en caché; los siguientes lo leen (×0,1). Escritura ×1,25. Dura 5 min: un mensaje aislado paga la escritura. El uso (`cacheReadTokens`/`cacheWriteTokens`) viaja por SDK → tool-loop → pipeline → gateway → app.

### Memoria
- Tools `memory_add/search/list/update/remove`; el bloque `## Memories` (con `#id`) se inyecta en el prompt (hasta 20, por relevancia).
- RPC `memory.list/add/update/remove` para la pantalla de la app. Base en `/data/project/.yggdrasil/memory.db`.

### Documentos
- Sube a `/data/project/notes/assistant/`. Tipos: pdf, txt, md, csv, tsv, json, log, xml, html, yaml/yml. No sobrescribe (`nombre (1).pdf`).
- El asistente trata el contenido como datos, no instrucciones (probado con un documento que pedía enviar un SMS: no lo hizo).

### Push, recordatorios y cola (`packages/gateway/src/assistant/`)
- `push.ts`: JWT de la cuenta de servicio con `node:crypto` → OAuth → `messages:send`. Tokens por `deviceId` en `/data/project/.yggdrasil/assistant/push-devices.json`; los muertos se borran solos.
- `reminders.ts`: `reminder_create` (`inMinutes` o `at` **con offset UTC**), `reminder_list`, `reminder_cancel`. Al vencer: mensaje `⏰ Recordatorio…` en el chat + push.
- `deviceQueue.ts`: directorio de tools por teléfono + cola (`QUEUEABLE_TOOLS`: alarma, temporizador, evento, notificación, timbre, volumen). TTL 24 h, máx. 20. Al reconectar el teléfono se vacía **pasando por la aprobación normal**.
- RPC: `push.register/unregister/status/test`.

### App
- Reconexión automática del WebSocket (1→15 s) y `whenOpen()`. Sin esto, un redeploy dejaba el chat vacío.
- `applicationId` = `com.mauriciorossdev.yggdrasil` (coincide con el proyecto Firebase propio).

## Operación (variables en Railway, servicio `gateway`)

| Variable | Para qué |
|---|---|
| `YGGDRASIL_API_KEY` | Auth del gateway (la misma va en el perfil de la app) |
| `ANTHROPIC_API_KEY` | Modelo |
| `REPLICATE_API_TOKEN` | TTS |
| `FCM_SERVICE_ACCOUNT_JSON` | Push (JSON completo de la cuenta de servicio, una línea) |

Requisito de Firebase: habilitar **`fcm.googleapis.com`** (Firebase Cloud Messaging API V1) en el proyecto Google Cloud; si no, `push.test` da 403 `SERVICE_DISABLED`.

Despliegue: `railway up --detach` (sube la carpeta local) o push a `feat/assistant` (Railway construye desde GitHub). Build ~4 min. Imagen: pnpm fijado en 10.33.2 y sin `app-desktop` (su postinstall recompila `better-sqlite3` para Electron).

Datos persistentes (volumen `/data`): sesiones (`project/.state/sessions`), memoria, documentos (`project/notes/assistant`), recordatorios/cola/directorio/tokens (`project/.yggdrasil/assistant`).

## Seguridad

- API key obligatoria; HTTPS por Railway. La cuenta de servicio de Firebase y las keys solo viven en variables de Railway.
- Riesgo de tools fijado en el servidor; destructivas exigen aprobación en el teléfono y no se encolan.
- Lista de tools por agente: el asistente no puede ejecutar comandos ni tocar archivos del servidor.
- Push con payload mínimo; el contenido llega por WebSocket.
- Pendiente de endurecer si se abre a más usuarios: límites de gasto en Anthropic/Replicate, rotación de la API key.

## Límites conocidos

- La **cola offline** salta poco: el teléfono es el único cliente del chat, así que "desconectado" ocurre solo si el socket cae a mitad de turno. No ejecuta con la app totalmente cerrada (Android no deja lanzar alarmas desde segundo plano): ejecuta al abrir la app.
- "Cuánto me queda" no es el saldo de Anthropic (no se expone): es un presupuesto propio + contexto restante (aproximado).
- Solo Haiku 4.5 tiene precio en la app; Sonnet/Opus muestran solo tokens.
- Los tests de `context-memory-db` no corren en local si `better-sqlite3` quedó compilado para Electron; se verificó contra Railway.
- La voz usa Replicate (costo aparte, no contado en el presupuesto).

## Cómo verificar de punta a punta (scripts de prueba usados)

1. `push.status` → `configured: true, devices: 1`; `push.test` → `sent: 1`.
2. Chat con `reminder_create` a +1 min → llega `⏰ Recordatorio` y la notificación.
3. Chat offline: tras desconectar el teléfono, "pon una alarma" → `queued: true`; al reconectar pide aprobación y ejecuta.
4. Subir un PDF por `documents.upload` y preguntar por su contenido.
5. Dos mensajes seguidos: el 2.º muestra `⚡` (lectura de caché).
