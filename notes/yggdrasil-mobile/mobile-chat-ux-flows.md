# UX: Mobile chat — multi-chat, tool-call cards, device-tools (sync/interactive)

Estado: **cerrado** — implementado por Frontend (approval card, tool-card sync, estado interactive). Sección 6 original (preguntas abiertas) respondida por Architect en `phone-gateway-connectivity-design.md` sección 5 (2026-09-04); este doc ya incorpora esas respuestas y las 3 correcciones que trajeron (composer bloqueado durante cualquier turno, cancelación optimista/inmediata, retry vía nudge-message). Quedan gaps no bloqueantes de implementación (protocolo/nativo), ver §6. **§7 (2026-09-05, nuevo) — hallazgo de Frontend: backgrounding tras tools tipo `startActivity()` (`phone_open_app`/`phone_set_alarm`) cuelga "Pensando..." sin timeout. Propuesta lista, con una pregunta de hecho abierta para Architect que decide si hace falta foreground service.**
Basado en: `notes/yggdrasil-mobile/phone-gateway-connectivity-design.md` (secciones 3 y 5) + estado actual del código (`mobile/app/lib/main.dart`, `yggdrasil_client.dart`, desktop `ApprovalBar.tsx`).

## 0. Estado actual (punto de partida)

`main.dart` hoy es una sola pantalla: terminal xterm que dumpea `chat.delta`/`chat.final` como texto plano, un input, autocomplete de slash-commands, y un drawer con "Configurar API URL" / "Configuración de Agente". No hay: lista de sesiones, burbujas de mensaje, tarjetas de tool-call, ni ningún manejo de `device.tool.*`. Todo lo de acá abajo es sobre esa base — no hay que preservar el look de terminal, se reemplaza por chat normal (burbujas), pero si Frontend quiere quedarse con estética "consola" para debug eso es charla aparte, no lo asumo acá.

Convención a reusar de desktop (`ApprovalBar.tsx`): approval card = nombre del tool + `risk-{level}` tag + args crudos (JSON) + Approve/Deny. La propuesta de abajo es la versión mobile de esa misma card, con un tercer estado (`interactive`) que desktop no tiene todavía.

---

## 1. Navegación

```
┌─────────────────┐         tap chat          ┌─────────────────┐
│  Chat list       │ ───────────────────────►  │  Chat detail     │
│  (home)          │ ◄─────────────────────── │  (mensajes)      │
└─────────────────┘         back                └─────────────────┘
        │                                                │
        │ tap "+"                                        │ drawer/menu
        ▼                                                ▼
   crea sesión nueva                            Config API / Agente
   (sessions.list → nuevo                       (ya existe, se reubica)
    sessionKey) → entra
    directo a Chat detail
```

- **Chat list es home**, no el chat directo — hoy no hay lista, se agrega como pantalla nueva y pasa a ser la raíz. Reemplaza al drawer actual como punto de entrada (el drawer de Config queda accesible desde adentro del chat, ver §1.2).
- Back desde Chat detail vuelve a Chat list (no cierra la app). Estándar Android: back button del sistema hace lo mismo.
- Swipe-back / gesture nav si la plataforma lo da gratis (Android predictive back) — no es algo a implementar a mano, pero no lo bloqueen con un `WillPopScope` que lo intercepte sin necesidad.

### 1.1 Chat list

```
┌───────────────────────────────┐
│ Yggdrasil            [+]  ⋮   │  ← título + nuevo chat + overflow (config)
├───────────────────────────────┤
│ ● Buscar factura de luz        │  ← título auto (primer mensaje o resumen)
│   "che encontrá el pdf..."     │     preview del último mensaje
│   hace 2h                      │
├───────────────────────────────┤
│   Sesión sin título            │  ← chat vacío recién creado, o sin resumen
│   hace 5 min                   │     aún (fallback: "Nuevo chat")
├───────────────────────────────┤
│ ● Abrir Spotify                │  ● = indicador de actividad (ver abajo)
│   "abrí spotify"                │
│   ayer                         │
└───────────────────────────────┘
```

- Fuente: `sessions.list` (ya soporta título/metadata — confirmado en el diseño técnico, no hace falta método nuevo).
- Orden: más reciente actividad primero.
- **Indicador `●` junto al título**: **confirmado por Architect — 100% client-side, sin campo nuevo en `sessions.list`.** La conexión WS ya recibe eventos de todas las sesiones (`tool.approval.requested`, `device.tool.invoke.requested`, sus resoluciones), cada uno con `sessionKey`. Mantener un mapa local `sessionKey → pendiente sí/no`: se prende en `*.requested`, se apaga en `tool.approval.resolved`/`device.tools.result`/`device.tool.invoke.cancel`. **Caveat conocido y aceptado para v1**: solo vive mientras la conexión esté viva — si la app se mata o reconecta, se pierde el registro de qué quedó pendiente (no hay método de reconciliación tipo `pendingApprovals.list` todavía; queda como hardening v1.1 del lado Backend si el caso de "app mobile se mata mientras espera un picker" resulta común en la práctica).
- Long-press en un item → menú contextual: renombrar, borrar. **`sessions.delete({sessionKey})` ya existe** (agregado por Backend a pedido de este doc) — borra de verdad, no archiva. Sin approval gate; alcanza con confirm dialog nativo del lado cliente antes de llamar al método.
- Swipe-to-delete es aceptable como alternativa/complemento a long-press si Frontend ya tiene el patrón en otro lado del proyecto; si no, long-press alcanza para v1.
- Estado vacío (0 sesiones, primera vez que se abre la app): en vez de lista vacía, mostrar directo el composer de "nuevo chat" centrado con placeholder tipo "Preguntale algo a Yggdrasil" — no una lista vacía con un botón `+` solitario.

### 1.2 Acceso a configuración

Drawer actual ("Configurar API URL" / "Configuración de Agente") se mantiene pero cuelga del ícono `⋮` overflow en Chat list (no hace falta que viva en Chat detail también — configuración no es algo que se toque a mitad de conversación).

---

## 2. Chat detail — estructura de mensajes

Lista de mensajes tipo Claude/Gemini mobile: burbuja usuario alineada derecha, respuesta del modelo alineada izquierda, streaming token-a-token (ya soportado por `chat.delta`, solo cambia el sink: de `terminal.write` a append en el mensaje-en-progreso).

Dentro del flujo de mensajes, dos tipos de bloque nuevos que no son texto:

1. **Tool-call card (`sync`)** — inline, aparece y se resuelve rápido, ver §3.
2. **Approval card** — inline, bloqueante hasta que el usuario responde, ver §4.
3. **Device-tool interactive card** — inline, con estado de progreso largo, ver §5.

Todas viven en el mismo stream de mensajes (no un panel aparte) — el usuario lee la conversación de arriba a abajo y ve exactamente cuándo se pidió qué, en qué orden, igual que hoy pasa con approvals en desktop.

```
┌───────────────────────────────────────┐
│ ← Buscar factura de luz          ⋮    │
├───────────────────────────────────────┤
│                                         │
│  buscá el pdf de la factura de luz    │  (usuario, burbuja derecha)
│                                         │
│  ┌─────────────────────────────────┐  │
│  │ 🔧 phone_search_files    v      │  │  (approval card, ver §4)
│  │ Riesgo: medio                    │  │
│  │ { "query": "factura luz" }       │  │
│  │  [Rechazar]        [Aprobar]     │  │
│  └─────────────────────────────────┘  │
│                                         │
│  Bien, dale un toque en tu             │  (modelo, streaming normal)
│  teléfono...                           │
│                                         │
├───────────────────────────────────────┤
│  [Escribí un mensaje...]          ➤   │
└───────────────────────────────────────┘
```

---

## 3. Tool-call card — `sync` (`phone_open_app`, `phone_list_installed_apps`)

Sin espera humana en el cel — el diseño técnico dice timeout ~30s. La UX tiene que reflejar "esto ya pasó", no pedir paciencia.

**Estados** (lineal, sin cancelación de por medio — no hay nada que cancelar en algo que dura <1s en el caso feliz):

```
1. Ejecutando (spinner chico, <1s típico)
┌─────────────────────────────────┐
│ ⏳ Abriendo Spotify...            │
└─────────────────────────────────┘

2a. Resuelto OK
┌─────────────────────────────────┐
│ ✓ Abrió Spotify                  │
└─────────────────────────────────┘

2b. Error (app no encontrada, etc)
┌─────────────────────────────────┐
│ ✕ No se pudo abrir Spotify        │
│   App no instalada                │  ← mensaje de error legible, no
└─────────────────────────────────┘     el string crudo del gateway

2c. Timeout (30s sin device.tools.result)
┌─────────────────────────────────┐
│ ✕ Sin respuesta del teléfono      │
│   [Reintentar]                    │  ← única clase de sync error con
└─────────────────────────────────┘     acción — el resto son terminales
```

- Card compacta, una línea, sin expandir — a diferencia del approval no hay JSON crudo que mostrar salvo que falle (ahí sí mostrar el detalle del error, colapsado bajo un "ver detalle" si es largo).
- `phone_list_installed_apps`: el resultado (lista de apps) se muestra como texto/lista dentro de la burbuja de respuesta del modelo, no como parte de la tool-card — la card solo marca que la acción "listar apps" se ejecutó y devolvió N resultados; el modelo es quien narra/usa esos resultados en su respuesta.
- **Reintentar (2c) — confirmado por Architect: NO es un RPC directo que reinvoca la tool call.** Es un mensaje de chat normal tipo nudge ("Reintentá: X") que vuelve a pasar por `chat.send`/`runChannelTurn` — un retry que bypasea al LLM dejaría el resultado sin dueño en el historial de la conversación. Frontend puede renderizar ese nudge como línea de sistema ("Reintentando...") en vez de burbuja de usuario normal — es solo presentación, no cambia el protocolo.

---

## 4. Approval card (patrón reusable — sync e interactive)

Mismo mecanismo que ya existe para tools normales (`tools.approve`), aplicado a device-tools. Es la puerta antes de cualquier `device.tool.invoke.requested`, sea `sync` o `interactive` — el diseño técnico es explícito: el approval ocurre *antes* de mandar el invoke, así que esta card nunca se solapa temporalmente con la de progreso de §5.

```
┌─────────────────────────────────────────┐
│ 🔧 phone_search_files          [medio]   │  ← nombre + risk-tag (mismo
│                                            │     criterio que ApprovalBar
│ { "query": "factura de luz" }             │     de desktop: riskLevel del
│                                            │     tool, no inventado nuevo)
│  Esto va a abrir el selector de           │  ← copy extra SOLO para
│  archivos en tu teléfono.                 │     interactive: aclara que
│                                            │     hay UI del sistema de
│  [ Rechazar ]           [ Aprobar ]       │     por medio antes de que
└─────────────────────────────────────────┘     apruebe a ciegas
```

- Risk tag: mismo vocabulario que desktop (`safe`/`medio`/`alto` o el que use `riskLevel` real — no inventar taxonomía nueva mobile-only). `riskLevel` lo asigna el gateway server-side por nombre de tool (mapping fijo, fail-closed a `destructive` para nombre desconocido) — el cliente nunca lo declara ni lo infiere. Los 4 tools de v1 (`phone_open_app`, `phone_list_installed_apps`, `phone_search_files`, `phone_list_documents`) están mapeados como `safe`, así que en modo `auto` esta card en la práctica casi no se muestra para ellos hoy — el mockup de abajo es ilustrativo (útil para cuando se agregue un device-tool `moderate`/`destructive` a futuro, ej. mandar un SMS).
- Args crudos en monoespaciado, igual que desktop (`JSON.stringify` legible) — usuario power-user, no hace falta traducir cada campo.
- La línea "Esto va a abrir el selector..." solo aparece si el tool es `kind:"interactive"` — para `sync` (`phone_open_app`) no hace falta, es autoexplicativo y no amerita el aviso.
- Aprobar → transiciona a la card de §3 (sync) o §5 (interactive) en el mismo lugar del stream (la approval card se reemplaza/colapsa a un resumen de una línea: "✓ Aprobado — phone_search_files", no queda ocupando espacio).
- Rechazar → una línea terminal: "✕ Rechazado — phone_search_files", el modelo recibe el deny y sigue la conversación con eso.
- **auto-approve (`approvalMode` en `yolo`) — confirmado por Architect tal cual esta propuesta**: la card ni se muestra — pasa directo al estado de ejecución/progreso con una línea sutil tipo "Auto-aprobado (modo yolo)" antes del spinner, para que quede rastro de que pasó sin intervención. Decidible 100% client-side (el cliente ya recibe el `approvalMode` activo por evento), sin cambios de protocolo.

---

## 5. Device-tool interactive — `phone_search_files`/`phone_list_documents` (SAF picker)

Esto es el corazón del pedido: **no debe verse colgado** mientras el usuario interactúa con el picker nativo de Android, y tiene que poder cancelarse.

### 5.1 Máquina de estados (mapeada 1:1 a los eventos del diseño técnico §3.3)

```
approval aprobado
      │
      ▼
┌─────────────────────────┐  device.tool.invoke.requested (kind:interactive)
│ Abriendo selector...     │  emitido, todavía no hay progreso del cel
└─────────────────────────┘
      │
      │ device.tool.invoke.progress {status:"awaiting_user"}
      ▼
┌─────────────────────────────────────┐
│ 📱 Esperando selección en tu         │  ← estado principal, puede durar
│    teléfono...                        │     minutos — sin spinner de
│                                        │     "cargando", con ícono estático
│    [ Cancelar ]                       │     + texto claro de que la
└─────────────────────────────────────┘     acción está en el cel, no acá
      │
      ├── device.tools.result {ok:true, result:{...}}
      │        ▼
      │   ┌─────────────────────────────┐
      │   │ ✓ Archivo seleccionado        │
      │   │   factura-luz-agosto.pdf      │
      │   └─────────────────────────────┘
      │
      ├── device.tools.result {ok:false, error:"cancelled_by_user"}
      │   (usuario cerró el picker DEL LADO DEL TELÉFONO, no vía botón cancelar)
      │        ▼
      │   ┌─────────────────────────────┐
      │   │ ✕ Cancelado en el teléfono    │
      │   └─────────────────────────────┘
      │
      ├── usuario toca [Cancelar] en la app
      │   → RPC device.tool.invoke.cancel {requestId} al gateway
      │        ▼
      │   ┌─────────────────────────────┐
      │   │ ⏳ Cancelando...               │  ← transición local brevísima:
      │   └─────────────────────────────┘     SOLO el round-trip del RPC
      │        │                                (típ. <1s), no una espera
      │        ▼ {ok:true} del RPC (NO         de confirmación del cel —
      │          se espera al cel)             ver nota abajo
      │   ┌─────────────────────────────┐
      │   │ ✕ Cancelado                   │
      │   └─────────────────────────────┘
      │
      ├── ceiling largo vencido (conexión colgada/crash, sin timeout corto)
      │        ▼
      │   ┌─────────────────────────────────┐
      │   │ ✕ El teléfono no respondió        │
      │   │   [Reintentar]                    │
      │   └─────────────────────────────────┘
      │
      └── cel se desconecta mientras esto está pendiente
               ▼
          ┌─────────────────────────────────┐
          │ ✕ Se perdió la conexión con el    │
          │   teléfono mientras esperaba       │
          │   [Reintentar]                     │
          └─────────────────────────────────┘
```

### 5.2 Detalles de UX por estado

- **"Abriendo selector..." (pre-progress)**: ventana corta entre el approval y el primer `awaiting_user`. Si tarda visiblemente (>1-2s) sin evento de progreso, igual no hay que inventar nada — el diseño técnico marca el evento de progreso como *opcional*; si nunca llega, saltar directo del approval al resultado final está bien, pero mostrar spinner genérico en el medio para no dejar el hueco vacío.
- **"Esperando selección..." es el estado que más importa diseñar bien**: es indefinido en el tiempo por diseño (SAF espera al humano). Evitar cualquier spinner infinito tipo loading-spinner clásico — connota "algo está cargando", que es engañoso (nada está cargando, el usuario tiene que ir a mirar su pantalla). Usar ícono estático (📱 o ícono de teléfono) + texto, sin animación de "processing". Opcional: un pulso muy sutil (no un spinner) para indicar "vivo" sin sugerir carga.
- **Botón Cancelar siempre visible en ese estado** — no escondido en un menú. Es la única acción del usuario disponible mientras espera.
- **Confirmación antes de cancelar**: NO pedir confirmación extra (no modal "¿Seguro?") — cancelar una espera de picker es de bajo costo/reversible (el usuario puede volver a pedirlo), agregar fricción ahí es peor UX que un cancelado accidental ocasional.
- **Cancelación es optimista/inmediata del lado gateway — confirmado por Architect, corrección al diagrama de 5.1.** El RPC `device.tool.invoke.cancel` resuelve la tool call en el gateway apenas responde (no espera al cel), y *después* manda el evento al cel como best-effort para que cierre el picker nativo — fire-and-forget, no algo que la UI deba esperar. Si el cel manda igual un `device.tools.result` tardío para ese `requestId`, el gateway lo rechaza (ya no hay entry pendiente) — ignorarlo del lado UI, no es un error a mostrar.
- **Multi-chat mientras espera**: si el usuario navega a Chat list o a otro chat mientras un `interactive` está en `awaiting_user`, el indicador `●` de §1.1 se prende en ese chat. Si vuelve y aprueba el picker en el teléfono mientras estaba en otra pantalla, la card se resuelve en background igual — al reabrir el chat ya está en su estado final, no hay que "esperar" de nuevo.
- **Composer bloqueado durante la espera — CORREGIDO por Architect, cambia mi propuesta original.** `chat.send` no tiene guard de concurrencia por `sessionKey` en el gateway — dos turnos en vuelo sobre la misma sesión arriesgan carrera/duplicado en el historial. Por eso: **deshabilitar el envío del composer mientras haya CUALQUIER turno en curso para esa sesión** (no solo durante `interactive` — también durante un `sync` corriendo o el modelo generando), hasta que ese turno cierre. Auto-cancelar el pending al escribir un mensaje nuevo, tampoco — cancelar una búsqueda que el usuario ya está haciendo en su cel porque tocó el input sin querer es peor UX que simplemente no dejarlo mandar todavía.
- **Reintentar** (ceiling vencido / desconexión): mismo criterio que §3 — es un nudge-message que vuelve a pasar por `chat.send`, no un RPC que reinvoca la tool call directamente. Si el `approvalMode` pide approval de nuevo, aparece la card — no se asume que el retry se lo salta.

---

## 6. Respuestas de Architect (cerradas) y gaps reales que quedan

Las 5 preguntas originales de esta sección fueron respondidas por Architect en `phone-gateway-connectivity-design.md` sección 5 (2026-09-04) y ya están incorporadas arriba (§1.1, §3, §4, §5.2). Resumen de las 3 que trajeron corrección real a la propuesta original:

- **Composer durante turno en curso**: mi propuesta original era no bloquearlo — Architect lo corrigió a bloqueado (gap real de concurrencia en `chat.send`, no solo preferencia de UX). Ver §5.2.
- **Cancelación del picker**: mi propuesta original asumía esperar confirmación del cel — es optimista/inmediata del lado gateway. Ver §5.1/§5.2.
- **Retry**: no es un RPC que reinvoca la tool call — es un nudge-message por `chat.send` (decisión de diseño, no gap). Ver §3/§5.2.

Las otras 2 (auto-approve en `yolo`, indicador `●`) confirmaron la propuesta original tal cual, sin cambios.

**Gaps que quedan, reportados por Frontend al terminar la implementación — son de protocolo/backend/nativo, no de diseño:**
1. `tool.execute` nunca lo emite nadie server-side todavía — Frontend resuelve por `turn.end` genérico como fallback.
2. `phone_search_files`/`phone_list_documents` no tienen nada nativo Android implementado todavía (el SAF picker real) — la card interactive existe y funciona con el protocolo, pero no hay forma de disparar el flujo real end-to-end.
3. Reconciliación de `tool.approval.requested` al reconectar — no existe (`pendingApprovals.list` o similar), asignado a Backend para v1.1, no v1. Ver caveat en §1.1.

Ninguno bloquea el diseño — están anotados acá para que quien retome esto sepa que el problema no es la UX.

**Resuelto en esta ronda**: `device.tool.invoke.cancel` sí existe como RPC (`methods.ts:841-851`, confirmado por Frontend) — era código desactualizado de su lado, no un gap real. Frontend ya actualizó `_cancelInteractive` a resolución optimista (coincide con §5.1/§5.2) y el comentario de retry de "gap" a "decisión confirmada". `flutter analyze`/tests limpios.

---

## 7. Backgrounding tras un device-tool que abre otra app (2026-09-05) — hallazgo de Frontend, patrón general

**El problema, reproducido 2/2 por Frontend**: `phone_open_app` y `phone_set_alarm` (y cualquier tool futuro de esta forma) llaman `startActivity()`, lo que backgroundea Yggdrasil — el usuario queda mirando Spotify/el reloj, no la app. Si el modelo todavía tiene más que decir después de esa tool call (otro tool-call, o la respuesta final), esa request queda suspendida por Android mientras la app está en background. Al volver manualmente, el usuario puede encontrarse un "Pensando..." colgado sin límite de tiempo y sin ningún aviso — hoy no hay timeout ni mensaje para este caso.

**Por qué un aviso solo en la tool-card resuelta NO alcanza**: el momento en que importa comunicar algo es *antes* de que el usuario se vaya de la app, no después — para cuando vuelve y mira la card, ya sabe que tardó, el aviso llega tarde. Y en el caso más común hoy (modo `auto`/riesgo `safe`, que es el de los 4 tools de v1 — ver diseño técnico punto 6) **no hay approval card de por medio en ningún modo** (ni gateway ni standalone: `profile_editor_screen.dart` ya documenta que standalone ejecuta estos 4 sin pedir aprobación, y en gateway con riskLevel `safe` tampoco se muestra) — no hay dónde poner un "esto va a abrir Spotify, ojo" antes del hecho salvo el instante brevísimo en que la tool-card `sync` pasa por su estado `running` (`SyncToolCard`, `status:'running'`) antes de disparar `startActivity()`.

### 7.1 Propuesta — dos partes, ninguna requiere foreground service todavía

**Parte A — copy en el estado `running` de la tool-card, vía flag de metadata general (`opensExternalApp: true` en `phoneDeviceToolSpecs`)**, no hardcodeado por nombre de tool:
```
Antes:  ⏳ Abriendo Spotify...
Ahora:  ⏳ Abriendo Spotify — puede tardar unos segundos extra al volver a Yggdrasil
```
- Mismo criterio para `phone_set_alarm` y cualquier tool futuro marcado `opensExternalApp: true` — un solo string genérico (ej. clave i18n `tool.opensAppHint`, reusando el sistema `AppStrings`/`tool.*` que ya existe en `sync_tool_card.dart`) apendeado al verbo de cada tool, no una frase por tool. Esto es lo que pide el pedido original ("pensalo como patrón general") — agregar un tool nuevo que abra otra app solo requiere marcar el flag, cero copy nueva.
- Es un aviso imperfecto (puede alcanzar a leerse o no según cuán rápido dispara `startActivity()` after pintar el frame), pero es gratis, no bloquea nada, y construye expectativa para la próxima vez aunque se pierda la primera — mejor que nada, no pretende ser la solución completa.

**Parte B — la que realmente importa: reconciliar el estado "Pensando..." al volver del background**, con `WidgetsBindingObserver` en la pantalla de chat (`didChangeAppLifecycleState`):
```
resume desde background, turno todavía en curso (_thinking true)
      │
      ▼
┌─────────────────────────────────┐
│ ⏳ Retomando después de Spotify…  │  ← reemplaza el "Pensando..." genérico
└─────────────────────────────────┘     apenas se detecta el resume — no
      │                                  hace al usuario adivinar qué pasó
      │ sin novedad tras ~15-20s desde el resume (valor a ajustar
      │ con Architect/Frontend según qué tan seguido se cuelga de verdad)
      ▼
┌─────────────────────────────────────┐
│ ✕ No llegó respuesta — puede haberse  │
│   perdido mientras estabas en         │
│   Spotify                             │
│   [Reintentar]                        │  ← mismo patrón de nudge-message
└─────────────────────────────────────┘     ya establecido en §3/§5.2, no
                                             un RPC nuevo
```
- Si la respuesta llega sola (buffer que se vacía al reconectar/foreground, sin pérdida real de datos) esto nunca escala más allá del primer estado — el usuario ve "Retomando..." por un instante y después la respuesta normal, en vez de nada hasta que decide investigar por qué no pasó nada.
- Si nunca llega, a los ~15-20s se convierte en un estado accionable en vez de un cuelgue silencioso indefinido — cierra el "no hay timeout ni aviso hoy" del hallazgo original.
- Generaliza al mismo flag `opensExternalApp` — se arma este flujo de "resume-aware" para cualquier turno que tenga una tool call de ese tipo en curso, no solo alarm/open_app.

### 7.2 Pregunta de hecho para Architect (determina si hace falta algo más pesado)

Lo que decide si esto necesita foreground service o no es un hecho técnico, no una preferencia de diseño: **¿la respuesta suspendida llega sola una vez que la app vuelve a foreground (dato solo demorado, nunca perdido), o se pierde de verdad y hace falta reenviar/replayear?** Si Frontend en su repro 2/2 en algún momento simplemente esperó con la app en foreground sin tocar nada y la respuesta terminó apareciendo, es la primera — ahí la Parte B de arriba (reconciliar UI, sin reenviar nada) alcanza sola y **no hace falta evaluar foreground service para v1**. Si en cambio hace falta mandar un mensaje nuevo para que algo pase, el dato se pierde de verdad, y ahí sí vale la pena que Architect evalúe foreground service (o mantener viva la conexión de otra forma) — no como fix de v1 necesariamente, pero sí como algo a decidir con datos reales en vez de asumir.
