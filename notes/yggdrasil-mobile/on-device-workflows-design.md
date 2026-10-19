# On-device workflows (Automate-style) + capability registry — design

Status: Phase 1 in progress (2026-10-04). Android only (iOS has no native channel).

## Goal
The phone creates and runs workflows **locally** (offline, local triggers),
like LlamaLab Automate: trigger → conditions → actions over device
capabilities. The same capabilities are usable from chat (the way
`phone_set_alarm` already is), and the chat can author workflows.

## 1. Capability registry (`lib/capabilities/`)
One `DeviceCapability` per `phone_*` tool: name, category, JSON-schema
parameters, kind (sync|interactive), riskLevel, needsForeground, l10n keys,
`run(args)`, and optional `cancel()` (interactive).

Every consumer derives from it, with no per-tool switch:
- `phoneDeviceToolSpecs` (device_tool_specs.dart) = `registry.toSpec()`. The
  wire format of `device.tools.register` and the standalone toolSpecs does
  not change.
- Gateway dispatch (yggdrasil_client.dart), standalone dispatch
  (device_tool_executor.dart), SyncToolCard labels, Capabilities screen
  categories, and chat_screen's interactive set.
- The gateway still owns risk in gateway mode (`methods.ts`
  `DEVICE_TOOL_RISK_LEVELS`), so every new tool must be added there too.

Kotlin: new capabilities go in classes that take a `Context` (not an
Activity), registered on any FlutterEngine. That is a prerequisite for the
background engine (§4). The existing MainActivity handlers stay put until
Phase 4.

## 2. New capabilities (Phase 2)
notification, clipboard get/set, device_state (battery/network/volume/ringer/
screen), ringer/volume, flashlight, brightness, location, SMS (send|compose),
call (dial|call), contacts search, open_url (deep links), share_to_app,
launch_intent (generic activity/broadcast/service), app shortcuts.
Risk: info/UI = safe, config changes = moderate, SMS/call/intent = destructive.

## 3. Local engine (Phase 3)
`lib/workflows_local/`. Same JSON shape as `packages/workflows/src/types.ts`
(Workflow/WfNode/WfEdge/Condition/handles), plus device triggers. Port of
conditions.ts and expressions.ts (path lookup only, no eval). Executor nodes:
if/set/delay/switch/loop/http.request/`phone.<capability>`, with
retry/timeout/onError. Storage is JSON in the app documents dir, readable by
the background engine.

Grant: a workflow with moderate/destructive nodes needs explicit
authorization (graph hash). An edit invalidates it. No grant means no
unattended runs.

## 4. Triggers + background (Phase 4)
Triggers: manual, schedule (HH:MM + weekdays, every ≥15 min), battery,
network/wifi, screen, notification (NotificationListenerService), geofence
(LocationManager proximity), boot.

Mechanism:
- A Kotlin foreground service detects triggers. Dart pushes the armed
  triggers to it, so it can filter without waking Dart.
- On a match it starts a background FlutterEngine
  (`workflowBackgroundMain`).
- Background activity-launch limit (Android 10+): `needsForeground`
  capabilities need SYSTEM_ALERT_WINDOW, or fall back to a notification the
  user taps.

## 5. UI (Phase 3)
- "Automatizaciones" at home level, not inside a gateway project.
- List screen: toggle, last run, run now.
- Linear editor with branches (trigger → steps; `if` gives true/false
  sub-lists). The parameter form is generated from the JSON schema.
- History: per-node output/error.
- Permission checklist per workflow.

## 6. Chat (Phase 5)
`phone_workflow_list/create/run/set_enabled`. `create` saves the workflow
**disabled** until the user authorizes it. The catalog of triggers and
capabilities in the description is generated from the registry.

## Phases
1. Registry refactor, no behavior change.
2. New capabilities.
3. Engine + manual trigger + UI.
4. Triggers + background + grants.
5. Chat authoring.

Between phases, test on the Samsung.

## Phase 2 — estado (2026-10-04)

Implementado: 16 capacidades (`lib/capabilities/capability_registry.dart`,
nativo en `android/.../DeviceCapabilities.kt`, canal `com.yggdrasil.app/device_caps`).
Permisos runtime concedibles desde Configuración → Capacidades → Permisos
(SMS, llamadas, contactos, ubicación, notificaciones). Auto-aceptar acciones
del teléfono: interruptor en la misma pantalla (`PhoneAutoApproveStore`).
Pendiente: brillo (requiere WRITE_SETTINGS) y accesos directos de apps
(solo con la app como launcher por defecto).

### Pendiente documentado: lecturas de comunicación (no implementado)

Decidido NO implementar todavía. Motivo: leer historial de llamadas o la
bandeja de SMS le da al LLM acceso a comunicaciones privadas. Es una decisión
de privacidad del usuario, no un límite técnico de Android.

Si se decide hacerlo:
- `phone_recent_calls` — `CallLog.Calls` (`READ_CALL_LOG`). Parámetros:
  `limit` (default 10, máx 100), `type` opcional (incoming|outgoing|missed).
  Devuelve número, nombre (si está en contactos), fecha, duración, tipo.
  Riesgo: `moderate`. Permiso: `Permission.phone` + `READ_CALL_LOG` (agregar
  `Permission.phoneCallLog` si permission_handler lo soporta, si no, pedirlo
  con platform channel).
- `phone_read_sms` — `Telephony.Sms` (`READ_SMS`). Parámetros: `limit`,
  `address` opcional (filtrar por número), `since` opcional (ISO-8601).
  Riesgo: `moderate`. Permiso: `READ_SMS`, que hay que verificar si
  `Permission.sms` de permission_handler lo cubre o si se pide aparte (no
  verificado todavía).
- Ambas: agregar a `DEVICE_TOOL_RISK_LEVELS` (`packages/gateway/src/methods.ts`),
  a la categoría "Comunicación" y a la pantalla de permisos.
- Google Play restringe READ_CALL_LOG y READ_SMS a apps que sean dialer o
  SMS por defecto. Para build personal (sideload/debug) no aplica, pero
  bloquea una publicación futura.
- Riesgo de privacidad a tener en cuenta: el resultado queda en el contexto
  del LLM y, en modo gateway, puede viajar al proveedor del modelo.
