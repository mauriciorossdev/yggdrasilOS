# Diseño: conectividad teléfono↔gateway + protocolo device-tools

Estado: diseño cerrado (Architect) — puntos 2, 3, 4, 6 y 9 de sección 4 resueltos. Punto 1 tuvo una corrección de hecho (ver abajo). Punto 5 (gateway-side de device-tools) reportado completo por Backend, pendiente de aplicar el mapping de riskLevel del punto 6 y el rename a `phone_*` del punto 9. Punto 7 (concurrencia `chat.send`) y punto 8 (`sessions.delete`) nuevos, abiertos, asignados a Backend.
Fecha: 2026-09-04 (actualizado: **corrección de hecho sobre auth** — el método `auth` NO es dead code, Backend lo encontró y ya lo arregló en el cliente; cierre de riskLevel para device-tools; hallazgo nuevo de concurrencia en `chat.send`; respuestas a las 5 preguntas de UX en `mobile-chat-ux-flows.md`; **rename de los 4 device-tools a prefijo `phone_*`** por colisión real de nombre con `tool-system/processes.ts:56`, hallazgo de Backend corriendo el E2E)

## 1. Qué hay hoy (leído del código)

**Gateway** (`packages/gateway/src/methods.ts`):
- Server WS, protocolo JSON-RPC-ish: `{id, method, params}` → `{id, result|error}`.
- Métodos core: `health`, `chat.send`, `chat.subscribe` (eventos `chat.delta`/`chat.final`), `config.get/patch`, `providers.list`, `agents.*`, `sessions.list/get/patch/reset/compact`, `fs.list/read/readBinary/readDocumentText/write/mkdir/rename/delete/search`, `tools.list/approve/approvalMode/setApprovalMode`, `skills.commands`, `channels.*`.
- `fs.*` está acotado a `workspaceRoot` vía `resolveWithinRoot` (evita path traversal) pero **sin approval gate** — cualquier cliente conectado puede leer/escribir/borrar archivos del proyecto directo, a diferencia de los tools del LLM que sí pasan por approval.
- Tools (`tools.list`, ejecución real) vienen de `@yggdrasil/tools-runtime`, **solo corren server-side**. No existe registro de tools por cliente remoto.
- Approval flow ya existe y es reusable como patrón: `pendingApprovals` Map keyed por `requestId`, evento `tool.approval.requested` emitido, cliente responde `tools.approve({requestId, approved})`, timeout 10min (`APPROVAL_TIMEOUT_MS = 10 * 60_000`, `methods.ts:65`) → deny. Este mismo patrón sirve de plantilla para device-tools (sección 3) y para cerrar el gap de `fs.*` (sección 4, punto 2).

**Eventos WS — shape real** (`packages/gateway/src/server.ts:108-154`): todo evento server→cliente se manda envuelto, **sin excepción**, como
```
{"type":"event", "event":"<nombre>", "payload":{...}}
```
(así salen hoy `chat.final`, `chat.delta`, `tool.approval.requested`, `tool.approval.resolved`, `turn.start`, `turn.end`, `tool.execute`, `provider.latency`, `tools.approvalMode.changed`, `agentflow.delegate.start`, y ya también `device.tool.invoke.requested/progress/cancel` — Backend los agregó al levantar 3.1-3.4 gateway-side, mismo wrapper, confirmado en el código actual de `server.ts:146-154`).

**Auth — CORRECCIÓN (Backend encontró el error, 2026-09-04)**: la versión anterior de este doc decía que el método `{"method":"auth",...}` era dead code porque solo chequeé el dispatch de `coreMethods` en `methods.ts` — **error mío, no revisé el gate que corre *antes* de ese dispatch**, en `server.ts` mismo. El flujo real, confirmado leyendo `server.ts:96-176` + `auth.ts` completo:
- Al conectar, `state.authenticated` se intenta setear con `isWsAuthenticatedByDefault(config) || tryAuthenticateFromQuery(config, url.searchParams.get("apiKey"))` (`server.ts:98-101`) — esto es lo único que vi la vez pasada.
- **Pero si eso da `false`** (`isGatewayAuthRequired(config)` es `true` — o sea hay una `apiKey` configurada, que es *exactamente* el caso de pairing/LAN que este diseño target — y el query param vino vacío o inválido), la conexión queda sin autenticar. En ese estado, `ws.on("message")` (`server.ts:163-176`) rechaza **todo** mensaje con `UNAUTHORIZED` salvo que sea, textual, `{method:"auth", params:{apiKey}}` — validado por `tryAuthenticateFromRequest` (`auth.ts:20-28`), que además solo lee `request.method === "auth"` (por eso nunca iba a aparecer en `coreMethods`, es un branch previo, no un core method).
- **Consecuencia del error**: Mobile había borrado el `send` de `auth` en `yggdrasil_client.dart` confiando en mi claim de dead code, y puso `device.tools.register` como primer mensaje. Si la query-auth fallaba, ese primer mensaje se leía en el branch de auth, fallaba (no es `method:"auth"`), y la conexión quedaba en `UNAUTHORIZED` permanente sin recovery — silencioso, sin reintento posible. Backend ya lo restauró (`yggdrasil_client.dart:142-158`): el cliente manda `{"id":"init-auth","method":"auth","params":{"apiKey":apiKey}}` como primer mensaje **siempre**, sea o no necesario (no-op inofensivo si la query-auth ya autenticó — el server solo lee ese branch cuando `state.authenticated` es `false`).
- **Ajuste al diseño (sección 2a)**: el token de pairing sigue viajando como `apiKey` en la query del connect, eso no cambia — pero el cliente **tiene que** implementar el fallback `{method:"auth",...}` como primer mensaje, no es opcional ni un detalle de implementación menor. Es más relevante todavía para 2a que para el caso actual: pairing/LAN-bind es justo el escenario con `isGatewayAuthRequired=true`, donde el fallback es el que realmente importa.

**Cómo se levanta el gateway** (`packages/app-desktop/src/main/gateway.ts`):
- `HOST = "127.0.0.1"` hardcodeado (línea 9). `getFreePort()` también bindea explícito a `127.0.0.1`.
- Un gateway = un child process por proyecto/ventana, puerto random, spawneado por Electron con `ELECTRON_RUN_AS_NODE`.
- Sin ningún flag hoy para bindear a LAN ni exponer el puerto fuera de loopback.

**Cliente Flutter** (`mobile/app/lib/services/yggdrasil_client.dart`):
- Skeleton: WS a `baseUrl` (persistido en `SharedPreferences`), request/response por `id` correlacionado, resto de mensajes (sin `id` pendiente) van a `onMessage`. Con el wrapper `{type:"event",...}` confirmado, `onMessage` debe filtrar por `response['type'] == 'event'` en vez de solo "no tiene id pendiente".
- Ya soporta multi-sesión a nivel de protocolo (`sessionKey` en `sendMessage`), gateway ya tiene `sessions.*` CRUD — buena base para el multi-chat con historial, no hace falta protocolo nuevo para eso (salvo `sessions.delete`, ver punto 8 de sección 4).
- `connectToMirror()` manda `auth` primero (ver arriba), después `device.tools.register` con `phone_open_app`/`phone_list_installed_apps` (`kind:"sync"`; `phone_search_files`/`phone_list_documents` quedan afuera del cliente por ahora, `kind:"interactive"`, ver punto 3 de sección 4), y escucha `device.tool.invoke.requested` para despachar a `device_tools_channel.dart`. **Backend reporta el lado gateway (methods.ts, server.ts, hook en tool-runtime) completo** — falta aplicar el mapping de `riskLevel` del punto 6 antes de considerar esto cerrado del todo.

## 2. Conectividad teléfono↔gateway — opciones

### a. LAN bind (0.0.0.0 o IP LAN) + auth
- **Cómo**: cambiar `HOST` a `0.0.0.0` o IP de LAN detectada, agregar pairing (token/código mostrado en desktop, el cel lo escanea/tipea, token viaja como `apiKey` en la query del connect). **El cliente tiene que implementar el fallback `{method:"auth",...}` como primer mensaje siempre** — ver corrección en sección 1, es justo el escenario donde ese fallback entra en juego.
- **Pros**: sin cable, funciona con cel en otra habitación, no depende de que adb detecte el dispositivo.
- **Contras/riesgos**: expone `fs.*` (read/write/delete sin approval, visto arriba) y `chat.send`/tools a cualquier host en la misma red — riesgo real en WiFi compartida/pública. Requiere UI de pairing, manejo de IP que cambia, firewall del SO puede bloquear.
- **Mitigar**: bind solo a la interfaz LAN específica (no `0.0.0.0` ciego), token de pairing de un solo uso + expiración corta, y — más importante, **bloqueante, ver punto 2 de sección 4** — cerrar el gap de `fs.*` sin approval antes de exponerlo fuera de loopback.

### b. adb reverse/forward por USB (sin red)
- **Cómo**: `adb reverse tcp:<port> tcp:<port>` (el cel conecta a `localhost:<port>` en el propio Android, adb lo túnela al `127.0.0.1:<port>` de la desktop) o `adb forward` en sentido inverso. Cero cambios en `HOST` del gateway — sigue en loopback.
- **Pros**: no toca superficie de ataque de red, no requiere UI de pairing nueva, setup trivial una vez que adb detecte el device. Reusa 100% el protocolo actual tal cual.
- **Contras**: depende de cable + adb funcionando (hoy el problema real del usuario es justo que adb no detecta el Samsung — bug aparte), no sirve para "cel libre por la casa" sin cable.
- **Riesgo de seguridad**: prácticamente ninguno adicional al de hoy.

### c. Relay intermedio
- **Cómo**: proceso extra (en la desktop o en la nube) que reenvía WS entre cel y gateway loopback.
- **Pros**: permitiría acceso remoto real (fuera de LAN) a futuro.
- **Contras**: complejidad y superficie de ataque nuevas, sin ganancia clara sobre (a) o (b) para el caso de uso actual. Es la opción con más riesgo y menos payoff hoy.

### Recomendación
Corto plazo: **(b) adb reverse por USB**.
Mediano plazo: **(a) LAN bind + pairing token**, solo después de meter approval gate a `fs.*` (punto 2 de sección 4) y con el fallback de auth del cliente implementado (sección 1).
**(c) relay** descartado por ahora.

## 3. Protocolo device-tools (teléfono ejecuta acciones que pide el LLM)

Objetivo: LLM (server-side) pide "abrí la app X" / "buscá archivo Y" / "listá apps instaladas" y el teléfono lo ejecuta y devuelve resultado a la UI/chat.

Patrón base: mismo que el approval flow existente (`pendingApprovals` en methods.ts), aplicado a *device tool calls* en vez de *approvals*. En Android moderno, `phone_search_files`/`phone_list_documents` pasan por SAF (Storage Access Framework), que abre un picker del sistema y espera interacción humana. Eso no entra en un timeout corto fijo. Se separan dos clases de tool.

### 3.1 Registro (cliente → gateway, al conectar o cuando cambian tools disponibles)
```
→ {"id":"...", "method":"device.tools.register", "params":{
    "tools":[
      {"name":"phone_open_app", "description":"...", "parameters": <json-schema>, "kind":"sync"},
      {"name":"phone_list_installed_apps", "description":"...", "parameters": <json-schema>, "kind":"sync"},
      {"name":"phone_search_files", "description":"...", "parameters": <json-schema>, "kind":"interactive"},
      {"name":"phone_list_documents", "description":"...", "parameters": <json-schema>, "kind":"interactive"}
    ]}}
```
- **`kind` es obligatorio** por tool, declara el contrato de timeout/UX:
  - **`"sync"`**: acción rápida, sin interacción humana en el cel. Timeout corto y fijo.
  - **`"interactive"`**: la ejecución involucra UI del sistema esperando al usuario. Sin timeout corto; requiere progreso y cancelación explícita (ver 3.3).
- **`riskLevel` NO va en este payload — CERRADO (Architect, 2026-09-04, punto 6 de sección 4).** El cliente no debe (y en la implementación actual de Mobile, no) declarar su propio nivel de riesgo. Ver punto 6 para el porqué y el mapping completo.
- Tools quedan asociadas a **esa conexión WS** (no persistidas), keyed por `sessionKey` o connection id. Vencen al desconectar (re-register al reconectar).
- `tools.list` del gateway mergea tools server-side + device tools de la conexión/sesión activa, mismo shape `{name, description, parameters}` + `kind` + `riskLevel` (asignado server-side, ver punto 6).
- **Nota de implementación real**: `yggdrasil_client.dart` manda este mensaje al conectar con `phone_open_app`/`phone_list_installed_apps`, deja `phone_search_files`/`phone_list_documents` afuera. Backend reporta el gateway-side completo (`device.tools.register`, `tools.list` merge, `invoke.requested`, `device.tools.result`, timeouts) — falta aplicar el mapping de riskLevel del punto 6.

### 3.2 Invocación — clase `sync`
Mismo patrón que `createGatewayApprovalHandler`, timeout corto porque no hay humano en el medio.
```
gateway: pendingDeviceToolCalls.set(requestId, {resolve, sessionKey, kind:"sync"})
gateway → context.events.emit("device.tool.invoke.requested", {requestId, toolName, args, sessionKey, kind:"sync"})
        → server.ts la reenvía por WS como:
  {"type":"event", "event":"device.tool.invoke.requested", "payload":{
      "requestId":"...", "toolName":"phone_open_app", "args":{"package":"..."}, "sessionKey":"...", "kind":"sync"
  }}

cel ejecuta acción nativa (platform channel Flutter↔Android) →

cel → {"id":"...", "method":"device.tools.result", "params":{
    "requestId":"...", "ok":true, "result":{...}  // o "ok":false,"error":"..."
  }}
```
- `SYNC_TOOL_TIMEOUT_MS` (propuesto: 30s) → si no llega `device.tools.result` a tiempo, gateway resuelve como error `"timeout"`.
- **Implementado gateway-side** (Backend, reportado 2026-09-04).

### 3.3 Invocación — clase `interactive` (SAF y similares)
```
gateway: pendingDeviceToolCalls.set(requestId, {resolve, sessionKey, kind:"interactive"})
gateway → evento "device.tool.invoke.requested":
  {"type":"event","event":"device.tool.invoke.requested","payload":{..., "kind":"interactive"}}

cel abre picker SAF → (opcional) progreso:
  {"type":"event","event":"device.tool.invoke.progress","payload":{"requestId":"...","status":"awaiting_user"}}

usuario elige archivo (o cancela) →

cel → {"id":"...","method":"device.tools.result","params":{"requestId":"...", "ok":true, "result":{...}}}
   // o:
cel → {"id":"...","method":"device.tools.result","params":{"requestId":"...", "ok":false, "error":"cancelled_by_user"}}
```
- **Ceiling largo**: `INTERACTIVE_TOOL_CEILING_MS = 10 * 60_000`, mismo valor que `APPROVAL_TIMEOUT_MS`. Constante global, no configurable por tool en v1.
- **Cancelación explícita**: gateway → `{"type":"event","event":"device.tool.invoke.cancel","payload":{"requestId":"..."}}`.
- **Desconexión del cel**: rechaza la `pendingDeviceToolCalls` entry de inmediato, no espera el ceiling.
- **Implementado gateway-side** (Backend, reportado 2026-09-04).

### 3.4 Resumen de la distinción
| | `sync` | `interactive` |
|---|---|---|
| Ejemplo | `phone_open_app`, `phone_list_installed_apps` | `phone_search_files`, `phone_list_documents` (SAF picker) |
| Espera humano en el cel | No | Sí |
| Timeout | Corto y fijo (~30s) | Sin timeout corto; ceiling largo = 10min fijo, no configurable por tool |
| Progreso | No aplica | `device.tool.invoke.progress` opcional |
| Cancelación | No aplica (falla sola por timeout) | `device.tool.invoke.cancel` explícito, + auto-cancel en desconexión |
| `riskLevel` (ver punto 6, sección 4) | `phone_open_app`: `safe` · `phone_list_installed_apps`: `safe` | `phone_search_files`: `safe` · `phone_list_documents`: `safe` |

- **Approval**: ambas clases pasan por el mismo `approvalMode` (auto/plan/restrict/yolo) que tools normales. El `riskLevel` que decide si hace falta approval en modo `auto`/`plan` es el que asigna el gateway server-side por nombre de tool (punto 6) — **no** un valor que mande el cliente. El approval ocurre *antes* de mandar `device.tool.invoke.requested`.
- **Todo evento gateway→cliente de esta sección usa el wrapper `{type:"event", event:"<nombre>", payload:{...}}`** — no bare. Las respuestas cliente→gateway (`device.tools.register`, `device.tools.result`) siguen `{id, method, params}` → `{id, result}`, no son eventos.

### 3.5 Multi-chat / historial (para el objetivo final, no bloquea este diseño)
Ya cubierto por protocolo actual: `sessionKey` + `sessions.list/get/patch/reset` dan multi-sesión con metadata/título persistido server-side. La UI mobile solo necesita listar `sessions.list`, mostrar picker, y mandar el `sessionKey` correcto en `chat.send`. **Excepción: borrar sesión no tiene método — ver punto 8 de sección 4.**

## 4. Abierto / a confirmar antes de implementar

1. **Auth — corregido, no solo "resuelto"** (ver sección 1). Query param `apiKey` en el connect es el camino principal, pero el cliente **tiene que** implementar el fallback `{method:"auth",params:{apiKey}}` como primer mensaje siempre — mi claim anterior de que ese método era dead code estaba mal, Backend lo encontró y ya lo corrigió en `yggdrasil_client.dart`. Sin este fallback, cualquier conexión donde la query-auth no alcance (típicamente el escenario de pairing/LAN de 2a) queda en `UNAUTHORIZED` permanente sin recovery.

2. **`fs.*` sin approval gate — CERRADO: bloqueante para 2a, no riesgo aceptable permanente.** El problema no es "cualquier archivo es legible" (eso ya pasa vía tool-loop del LLM, que sí pasa por approval) — es que `fs.*` **ignora el `approvalMode` configurado**. Fix: meter `fs.write/mkdir/rename/delete` (mutating) en el pipeline de `pendingApprovals`/`riskLevel` existente. `fs.list/read/readBinary/readDocumentText/search` (read-only) quedan como están — ya acotados a `workspaceRoot`+auth, forzar approval ahí es fricción sin beneficio proporcional. Con adb reverse (2b) no es bloqueante (gateway sigue en loopback), pero conviene cerrarlo igual antes de escalar a más de un cliente.

3. **Set de v1 de device-tools — CERRADO: alcanza.** `phone_open_app`+`phone_list_installed_apps` (sync) + `phone_search_files`+`phone_list_documents` (interactive, agregado en este cierre — estaba pausado en el código de Mobile sin estar documentado en 3.1). No agrego nada más (cámara, notificaciones, contactos) — sin caso de uso declarado.

4. **Ceiling largo de `interactive` — CERRADO: 10 minutos, constante global, no configurable por tool.** Mismo valor que `APPROVAL_TIMEOUT_MS`. Con solo 2 tools en esta clase y mismo patrón de UX (SAF picker), el knob por tool es complejidad para un caso hipotético.

5. **Mobile/Gateway desync — Backend reporta resuelto.** Gateway-side de 3.1-3.4 implementado (`methods.ts`, `server.ts`, hook en tool-runtime). **No cerrado del todo**: falta aplicar el mapping de `riskLevel` del punto 6 (Backend había puesto un default plano `"moderate"` para todo device-tool mientras esto se definía).

6. **`riskLevel` para device-tools — CERRADO (Architect, 2026-09-04, respuesta a Backend).** La sección 3.4 decía "mismo `riskLevel` que tools normales" sin definir de dónde sale ese valor para device-tools, dado que `device.tools.register` solo manda `kind`. Backend preguntó: ¿default plano `"moderate"` para todos, o configurable por tool en el payload de `register`?
   - **Ninguna de las dos.** El enum real es `"safe"|"moderate"|"destructive"` (`tools-sdk/src/types.ts:33`), y el gate en `tool-loop.ts:132-148` solo agrega fricción cuando es `"moderate"`/`"destructive"` (en modo `auto`, que es el default, decide si hay diálogo o no; en `plan`, si autodeniega o corre). Un `"moderate"` fijo para los 4 tools mete approval-dialog hasta para `phone_list_installed_apps`, que es un read puro sin side-effect — fricción sin motivo, y rompe el patrón que ya usa el resto del código (`tool-system/open-path.ts`, `system-info.ts`, `processes.ts` = `"safe"` para acciones sin daño real; `"destructive"` para write/delete/shell — ver `tool-system/filesystem.ts`, `shell.ts`, `tool-documents/tools.ts`).
   - **Tampoco configurable por tool en el `register` payload.** El `riskLevel` en el resto del código lo declara el archivo que es *dueño* del tool — código propio, revisado, de confianza. Un device-tool lo registra un cliente remoto (el teléfono); dejar que ese mismo cliente se autoasigne `"safe"` para lo que quiera es el mismo problema de fondo que el gap de `fs.*` del punto 2: confiar en que quien pide el permiso también define cuánto permiso necesita. `kind` (sync/interactive) sí puede seguir siendo client-declared porque ahí un valor mal puesto solo produce un timeout subóptimo — no hay bypass de seguridad posible. `riskLevel` es distinto: un valor mal puesto (o adversarial) directamente salta el gate.
   - **Fix: mapping estático server-side por nombre de tool**, mismo patrón que `tool-system`/`tool-documents` — hardcodeado en el gateway, no en el payload del cliente:
     ```
     phone_open_app:             "safe"
     phone_list_installed_apps:  "safe"
     phone_search_files:         "safe"
     phone_list_documents:       "safe"
     <nombre desconocido>: "destructive"   // fail-closed, no fail-open
     ```
     Los 4 tools de v1 quedan `"safe"` — ninguno es irreversible ni destructivo (abrir una app o listar/enumerar no borra ni muta nada), y para `phone_search_files`/`phone_list_documents` el picker SAF nativo ya es un checkpoint humano obligatorio en el propio cel, independiente del `approvalMode` del gateway — no hace falta duplicar esa fricción con un segundo diálogo de approval antes de siquiera abrir el picker. Un nombre de tool que el gateway no reconoce (typo, versión vieja del cliente, tool no declarado en este mapping) cae a `"destructive"` por defecto — fail-closed, no el default plano y permisivo que había hoy.
   - Si a futuro se agrega un device-tool con side-effect real (mandar un SMS, hacer una llamada, borrar algo del cel) va con `"destructive"` explícito en este mismo mapping — no hay que rediseñar nada, es agregar una línea.

7. **NUEVO — `chat.send` no tiene guard de concurrencia por `sessionKey`** (Architect, 2026-09-04, surgido al responder la pregunta de UX §6.3 en `mobile-chat-ux-flows.md`). `chat.send` (`methods.ts:852-...`) hace `await runChannelTurn(...)` de punta a punta — incluyendo cualquier espera de approval o de un device-tool `interactive` — antes de devolver la respuesta RPC. No hay ningún lock/queue por `sessionKey` en el medio (`sessionKeyToConnection` es solo un mapa connection↔session, no un mutex). Si el cliente manda un segundo `chat.send` con el mismo `sessionKey` mientras el primero sigue en vuelo (ej. esperando un picker SAF que tarda), corren dos `runChannelTurn` en paralelo sobre la misma sesión — riesgo real de historial duplicado/intercalado o carrera en `sessionStore`. Esto es un gap preexistente (no lo introduce device-tools, pero device-tools con esperas de minutos lo hace mucho más fácil de gatillar por accidente). Recomendación: el cliente debe evitar mandar un segundo `chat.send` mientras haya uno en vuelo para esa sesión (ver respuesta a UX §6.3 más abajo). Un guard server-side (rechazar/cola por `sessionKey`) sería más robusto pero no es bloqueante para v1 con un solo cliente mobile por sesión — **queda como hardening recomendado para Backend, no bloqueante.**

8. **NUEVO — `sessions.delete` no existe** (Architect, 2026-09-04, respuesta a UX §6.2). `sessions.list/get/patch/reset/compact` existen; borrar, no. La UX de Chat list (long-press → borrar) lo asume. **Decisión: agregar `sessions.delete({sessionKey})` gateway-side** en vez de simular un "archivado" vía `metadata.archived` — es un método chico, simétrico con el resto del CRUD que ya existe (gap real, no scope creep), y "borrar" en la UI debe borrar, no ocultar. No necesita approval gate tipo `tools.approve` — es una acción directa del usuario sobre sus propios datos vía su cliente autenticado, no una acción que el LLM le pide al usuario; alcanza con un confirm dialog client-side antes de llamar al método (ver respuesta a UX §6.2 más abajo). **Asignado a Backend**, chico, no bloquea a Frontend para arrancar el resto de la UX.

9. **NUEVO — colisión de nombre real entre tool server-side y device-tool: `list_installed_apps` — CERRADO (Architect, 2026-09-04, hallazgo de Backend corriendo el E2E).** `packages/tool-system/src/processes.ts:56` ya registra un tool server-side `list_installed_apps` (apps de escritorio: Windows registry/macOS `/Applications`/Linux pkg manager). El protocolo device-tools usaba el mismo nombre para el tool del cel. Confirmado en código: `tools-runtime/src/registry.ts:5-6` (`tools.set(def.name, def)`, un solo `Map<string, AgentToolDefinition>` global) + `tools-runtime/src/resolve.ts` (registra tools server-side primero, device tools de la conexión activa después, mismo registry — ver comentario en el archivo: "device-tools registered by a connected phone — into the same registry"). Consecuencia real, no hipotética: en cualquier sesión con un cel linkeado, el device-tool **pisa silenciosamente** al tool de escritorio con el mismo nombre — sin error, sin warning, el LLM no tiene forma de saber que `list_installed_apps` cambió de significado a mitad de sesión (lista apps del cel en vez de apps de la desktop), y si el usuario desvincula el cel a mitad de sesión el significado vuelve a cambiar otra vez, también silencioso.
   - **Fix: todos los device-tools de v1 pasan a tener prefijo `phone_`** — `phone_open_app`, `phone_list_installed_apps`, `phone_search_files`, `phone_list_documents`. Ya actualizado en todo este doc (3.1, 3.4, ejemplos de sección 3.2/3.3, punto 3 y 6 de esta sección). `phone_open_app` no tenía colisión (chequeado por Backend contra todo `tool-system`), pero lo prefijo igual por consistencia — que la mitad de los device-tools tengan prefijo y la otra mitad no es peor para el LLM (nombres inconsistentes) que prefijarlos todos.
   - **Por qué `phone_` y no `device_`**: hoy el único tipo de dispositivo remoto que existe es el teléfono — usar `device_` genérico implica una promesa de multi-tipo-de-dispositivo (tablet, wearable, etc.) que no está en scope y sería nombrar para un futuro hipotético. Si algún día se suma otro tipo de dispositivo, el rename es trivial (mismo costo que cualquier rename de tool) y se resuelve entonces, no antes.
   - **Por qué no un namespace con punto** (`device.list_installed_apps`, calcando el namespacing de los métodos/eventos del protocolo en sección 1/3): los nombres de tool que ve el LLM van con las reglas de function-calling de cada provider, que típicamente restringen el charset (`^[a-zA-Z0-9_-]+$` o similar) — un punto puede no ser válido ahí, mientras que un guion bajo siempre lo es. Los métodos/eventos WS (`device.tool.invoke.requested`, etc.) son un namespace distinto (protocolo interno gateway↔cliente), no tienen esta restricción y no hace falta que compartan convención con los nombres de tool que ve el LLM.
   - **Rename sincronizado en los 3 lugares — CERRADO (verificado en código, 2026-09-04).** `yggdrasil_client.dart` ya usa `phone_open_app`/`phone_list_installed_apps`, `device-tools.test.ts` renombrado + test nuevo cubriendo el mapping completo (4 tools `safe` + un nombre inventado `phone_send_sms` → `destructive`), y el mapping server-side implementado en `methods.ts:155-163` (`DEVICE_TOOL_RISK_LEVELS` + `deviceToolRiskLevel()`, fail-closed a `"destructive"` para nombre no reconocido, exactamente como se definió en el punto 6). `tools.list` ahora también expone `riskLevel` (`methods.ts:780`), gap que el doc pedía en 3.1 y que faltaba. Colisión de nombre + riskLevel plano, ambos resueltos.
   - **No toco `registry.ts`/`resolve.ts`** — el silent-overwrite en un `Map` keyed por nombre es una limitación general de cómo está armado el registry (server-side tools primero, device tools después, sin chequeo de colisión), y podría en teoría volver a pasar con un tool device futuro que no siga la convención de prefijo. Backend puede decidir si vale la pena un warning/error en `registerToolDefinition` cuando pisa una entrada existente — es un cambio más invasivo (afecta a todo el registry, no solo a device-tools) y no lo estoy pidiendo para v1; el prefijo `phone_` ya elimina la colisión conocida sin tocar código compartido.

10. **NUEVO — `device.tool.invoke.cancel` como RPC client→gateway, no solo evento — CERRADO (Architect, 2026-09-04, pregunta de Frontend).** El doc (3.3, 3.4) solo documentaba esto como evento gateway→cliente. Frontend preguntó si hace falta el RPC inverso para que la UI dispare la cancelación. **Respuesta: sí hace falta, y Backend ya lo implementó** — `packages/gateway/src/methods.ts:823-833` ya registra `device.tool.invoke.cancel` como `coreMethod` (`{id,method:"device.tool.invoke.cancel",params:{requestId}}` → `{id,result:{ok:true,requestId}}`), que:
    1. Busca la entry en `pendingDeviceToolCalls`. Si no existe (ya resuelta por otro camino), devuelve `{ok:true,requestId,alreadyResolved:true}` sin error.
    2. **Resuelve la promesa del tool-loop de inmediato** (`pending.reject(new Error("cancelled"))`) — no espera ninguna confirmación del cel.
    3. Recién después emite el evento `device.tool.invoke.cancel` de vuelta, que `server.ts` reenvía a **todas** las conexiones (incluida la que originó el RPC) con el wrapper estándar — ese evento es lo que le avisa al cel (si es él quien tiene el picker abierto) que cierre la UI nativa.
    - **No hay colisión real entre RPC y evento compartiendo el mismo nombre** — son formas de mensaje distintas en el wire (`{id,method,...}` vs `{type:"event",event,...}`), el cliente ya rutea por `type==='event'` (sección 1). Documentado ahora para que no genere la misma duda de nuevo.
    - **Corrección a la UX (`mobile-chat-ux-flows.md` §5.1)**: el estado "Cancelando..." de la máquina de estados propuesta ahí asume que se espera a que el cel confirme el cierre del picker antes de pasar a "Cancelado". **Eso no es lo que hace la implementación real** — la cancelación es optimista/inmediata del lado gateway en cuanto el RPC resuelve; el turno del LLM ya sigue con el resultado "cancelled" en ese momento. El evento que le llega al cel es fire-and-forget (best-effort, para que cierre la UI nativa), no algo que la UI deba esperar. Ajustar la UX: "Cancelando..." es una transición local brevísima (el tiempo del round-trip del RPC, típicamente bajo 1s) mientras se espera la respuesta `{ok:true,...}`, no una espera de confirmación del cel — si el cel manda igual un `device.tools.result` tardío para ese `requestId`, el gateway lo va a rechazar con error (`no pending device tool call`) porque ya no existe la entry; es inofensivo, ignorarlo del lado UI.

11. **NUEVO — retry de tool call sin RPC dedicado — CERRADO, aceptable para v1 (Architect, 2026-09-04, pregunta de Frontend).** Frontend resuelve el retry hoy mandando un chat message tipo "Reintentá: X" como nudge al LLM en vez de reinvocar la tool call exacta. **Confirmo ese approach, no es un workaround temporal, es la decisión correcta para v1**, no solo "aceptable":
    - Una tool call que bypasea al LLM (un RPC directo que reinvoque `device.tool.invoke.requested` con el mismo `toolName`/`args` sin pasar por `runChannelTurn`) crea un problema nuevo: ese resultado no tiene dueño en el historial de la conversación — o se inventa un tool_call/tool_result sintético en el transcript como si el LLM lo hubiera pedido (lift no trivial, y frágil por provider), o el resultado queda flotando fuera del historial y el LLM nunca se entera si el retry funcionó (rompe coherencia conversacional — el usuario pregunta "¿lo encontraste?" y el LLM no tiene contexto).
    - El nudge-message reusa 100% del protocolo existente (mismo `chat.send`, mismo approval gate, mismo tool-loop), mantiene todo tool-call atribuible a un turno del LLM, y con los 4 tools de v1 en `riskLevel:"safe"` (punto 6) el approval ni siquiera entra en juego en modo `auto` — así que la preocupación original de "no reabrir approval en el retry" (texto viejo de 3.2/3.3) no aplica en la práctica para v1.
    - Único ajuste sugerido, de UX no de protocolo: no hace falta que el nudge se vea como un mensaje de usuario normal en la burbuja — Frontend puede renderizarlo distinto (una línea de sistema tipo "Reintentando..." en vez de una burbuja de chat) sin ningún cambio de protocolo, `chat.send` no le importa cómo se ve el texto que manda.

12. **NUEVO — preview del último mensaje en `sessions.list` — CERRADO (Architect, 2026-09-04, pregunta de Frontend).** `sessions.list` hoy solo trae `messageCount` (`packages/sessions/src/store.ts:55-79`, `SessionSummary`), no contenido. **Decisión: extender `sessions.list` con un campo `lastMessagePreview: string | null` calculado server-side**, no armarlo client-side.
    - Es prácticamente gratis: `store.list()` ya lee y parsea el JSON completo de cada sesión en disco (`record.messages` completo) solo para sacar `messages.length` — el último mensaje ya está en memoria en ese mismo loop, agregar el preview no agrega I/O ni un segundo round-trip.
    - La alternativa (que la UI pida `sessions.get` por cada sesión de la lista para sacar el preview) es N+1 llamadas por cada render de Chat list — exactamente el tipo de cosa que no hay que dejar que la UI resuelva por su cuenta cuando el server ya tiene el dato a mano.
    - **Detalle de implementación para Backend**: tomar el último mensaje con contenido de texto no vacío (saltar mensajes de solo tool-result o solo imagen si hace falta caminar hacia atrás), aplanar a una sola línea, truncar a ~120 caracteres con elipsis. No hace falta persistir nada nuevo ni migrar sesiones viejas — el campo es opcional/ausente-seguro para registros sin mensajes.
    - Gateway no necesita cambios más allá del tipo — `methods.ts:450-455` (`sessions.list`) ya hace `pass-through` de `store.list()` tal cual.

13. **NUEVO — reconciliación de pendientes al reconectar — abierto, v1.1, no bloqueante (Architect, 2026-09-04, confirmado con Orchestrator).** Punto 5 de sección 5 (indicador `●`) asumía client-side tracking vía eventos en la conexión viva, con el caveat de que se pierde en reconexión. Confirmado que en la práctica esto importa (mobile: pantalla bloqueada, WiFi cae — seguido, no edge case raro), pero **el alcance real es más chico de lo que puse en mi primera pasada** — precisando contra el código:
    - **`device.tool.invoke.requested` (interactive incluido) NO es el caso que necesita reconciliación**: está atado a `connectionId` (`pendingDeviceToolCalls`), y `handleGatewayConnectionClosed` (`methods.ts:179-191`) lo rechaza de inmediato apenas esa conexión específica se cae — no sobrevive una desconexión de quien lo registró. Un reconnect del cel es siempre una conexión nueva (nuevo `connectionId`), así que no hay una call `interactive` vieja flotando para reconciliar del lado del cel que la originó.
    - **El caso real es `tool.approval.requested`** (`pendingApprovals`, `methods.ts:75`) — ese map **no está atado a ningún `connectionId`** y no tiene ningún cleanup en `handleGatewayConnectionClosed`. Un approval normal (ej. un `fs.write` gateado por el fix del punto 2, o a futuro un device-tool `"destructive"`) sigue vivo server-side hasta los 10min de `APPROVAL_TIMEOUT_MS` sin importar si el cliente sigue conectado — exactamente el escenario que se pierde de vista si la app se reinicia o el WiFi cae y vuelve.
    - **No se implementa para v1** — queda como hardening v1.1: agregar `tools.pendingApprovals.list` (o nombre similar) que el cliente pueda pedir al reconectar, para reconciliar approvals que quedaron vivos en el gateway mientras estuvo desconectado. No hace falta que cubra `device.tool.invoke.requested` — ese caso ya se resuelve solo por el fail-fast de `handleGatewayConnectionClosed`. **Asignado a Backend para v1.1, no v1.**

14. **NUEVO — `params.x !== undefined` trata `null` explícito como valor real en todo `methods.ts` — CERRADO como decisión, implementación abierta (Architect, 2026-09-04, encontrado en el E2E: `agentId: null` explícito hacía `chat.send` caer a modo echo en vez de la LLM real).** Confirmado en código: `methods.ts:881` (y 18 sitios más — `agentId`/`provider`/`model`/`label`/`harness`/`systemPrompt`/`title`/`relativePath`/`content`/`sessionKey`, en `agents.create/get`, `sessions.patch`, `chat.send`, `fs.write`, `channels.*`) usan el patrón `params.x !== undefined ? String(params.x) : undefined`. Como `null !== undefined` es `true` en JS, un cliente que manda `"agentId": null` explícito (en vez de omitir la key — común si viene de un modelo tipado con campo nullable que serializa `null` en vez de ausente) termina con `String(null) === "null"` — el string literal, no `undefined` — y ese `"null"` se usa después como si fuera un agentId real, con la consecuencia observada de caer a un modo default/echo en vez de resolver el agente correcto.
    - **Fix recomendado, no puntual**: no parchear solo `chat.send:881`, es el mismo bug en los otros 18 sitios y va a volver a aparecer en el próximo método nuevo que copie el patrón. Meter un helper compartido, ej. `optionalString(value: unknown): string | undefined { return value == null ? undefined : String(value); }` (`==` flojo, para que cubra `null` y `undefined` en el mismo chequeo), y reemplazar los 19 call-sites por ese helper.
    - **Por qué es relevante para este diseño y no solo un bug interno**: cualquier cliente que le pegue directo al protocolo (device-tools, mobile, o un cliente nuevo a futuro) puede pisar esto en cualquiera de los 19 puntos, no solo en `chat.send`. Vale la pena que quede documentado acá como parte del contrato — un cliente prolijo debería omitir keys opcionales en vez de mandar `null`, pero el gateway no debería depender de que todos los clientes lo hagan bien.
    - **Asignado a Backend.** No bloqueante para lo que ya está en curso (E2E, SAF nativo) — ya se desbloqueó localmente para poder probar — pero sí antes de sumar más clientes que hablen el protocolo directo.

---

## 5. Respuestas a `notes/yggdrasil-mobile/mobile-chat-ux-flows.md` §6 (Architect, 2026-09-04)

1. **Auto-approve visual en `yolo`**: confirmo la propuesta de UX tal cual — la approval card **no se muestra**, pasa directo a la card de progreso/ejecución, pero con una línea sutil antes del spinner tipo "Auto-aprobado (modo yolo)". Motivo: `yolo` existe para saltar la fricción, mostrar la card completa y "pre-marcarla aprobada" reintroduce esa fricción visual sin ganar nada; pero el usuario necesita rastro de que algo pasó sin intervención (mismo criterio de transparencia que ya usan los eventos de `tools.approvalMode.changed`). No requiere cambios de protocolo — el cliente ya sabe el `approvalMode` activo (lo recibe por evento) y puede decidir esto 100% client-side.

2. **`sessions.delete`**: ver punto 8 de sección 4 — se agrega el método, no se simula con `archived`. Frontend puede implementar el long-press→borrar de §1.1 tal como está propuesto, apuntando a este método nuevo. Sin approval gate; un confirm dialog nativo alcanza.

3. **Mensaje nuevo mientras hay un `interactive` (o cualquier tool) pendiente**: **no** es la propuesta original de UX (permitir mandar otro mensaje libremente) — ver punto 7 de sección 4, recién encontrado: `chat.send` no tiene guard de concurrencia por sesión, así que dos turnos en vuelo sobre el mismo `sessionKey` corren riesgo real de carrera en el historial, no es solo un tema de UX. **Decisión: bloquear el composer (deshabilitar el envío) mientras haya un `chat.send` en vuelo para esa sesión** — no solo durante un `interactive` pendiente, durante *cualquier* turno en curso (sync tool corriendo, generación en curso, lo que sea) — es el mismo riesgo subyacente en todos los casos, no vale la pena distinguir "es interactive, bloqueo" de "es sync, dejo pasar" cuando ambos casos son la misma sesión con un turno abierto. Auto-cancelar el pending al mandar un mensaje nuevo **no** — cancelar una búsqueda de archivo que el usuario ya está haciendo en su cel porque mandó sin querer otro mensaje es peor UX que simplemente no dejarlo mandar hasta que el turno actual cierre.

4. **Progreso granular futuro**: no diseño nada nuevo ahora — YAGNI. El campo `status` de `device.tool.invoke.progress` es un string libre que el gateway pasa a través tal cual (no hay un enum validado del lado gateway), así que agregar estados nuevos a futuro (ej. "navegando carpetas") es aditivo, cero cambio de protocolo. Recomiendo que el cliente trate cualquier `status` desconocido con un copy genérico tipo "En progreso..." en vez de fallar o no mostrar nada, para que esto sea forward-compatible sin coordinar un release.

5. **Indicador `●` / `hasPendingApproval`**: no hace falta campo nuevo en `sessions.list`. El cliente ya recibe, sobre la misma conexión WS, *todos* los eventos de *todas* las sesiones (`tool.approval.requested`, `device.tool.invoke.requested`, sus resoluciones) — cada payload trae `sessionKey`. Alcanza con que el cliente mantenga un mapa local `sessionKey → pendiente sí/no`, prendido por `*.requested` y apagado por `tool.approval.resolved`/`device.tools.result`/`device.tool.invoke.cancel`. **Caveat real**: esto solo vive mientras la conexión WS esté viva — si la app se mata o reconecta, se pierde el estado de qué quedó pendiente antes del corte. Hoy no hay ningún método tipo `approvals.list`/`pendingApprovals.list` para reconciliar al reconectar (confirmado: no existe en `methods.ts`, solo `tools.approve`/`approvalMode`/`setApprovalMode`). Si esto importa para v1 (¿la app mobile se mata seguido en Android por memory pressure mientras espera un picker de minutos?) es una pregunta de producto, no de diseño — si la respuesta es sí, hace falta un método de reconciliación nuevo y eso sí es scope adicional para Backend. Por ahora no lo agrego sin ese caso de uso confirmado.

---
Generado con Claude Code — sesión: https://claude.ai/code/session_0116JqfBKympUw3Xhmr2ZVu4
</content>
