# Análisis: acciones externas del LLM — conectores server-side (Google Calendar/Gmail) + intents nativos del cel (alarma, etc.)

Estado: **análisis, sin implementar** — a pedido explícito del usuario. Nada de esto se toca en código todavía.
Basado en: lectura del código actual (`packages/context-sdk/src/index.ts`, `packages/kernel/src/registry.ts`, `packages/config/src/{index,auth,sanitize}.ts`, `packages/gateway/src/methods.ts`, `mobile/app/android/.../MainActivity.kt`, `mobile/app/lib/services/device_tool_specs.dart`) + todo lo ya cerrado en `phone-gateway-connectivity-design.md` y `remote-access-analysis.md`.
Fecha: 2026-09-04.

Los dos temas que pidió el usuario comparten la misma pregunta de fondo — **cómo el LLM ejecuta una acción concreta fuera del propio chat, no solo lee/genera texto** — así que van en un solo doc. La respuesta corta: son dos ramas del mismo árbol (ambas terminan siendo `AgentToolDefinition`s que pasan por el mismo tool-loop/approval-gate ya existente), no dos sistemas distintos, y son complementarias, no competencia — sección 3 lo desarrolla.

## 1. Tema 1 — Conectores externos (Google Calendar/Gmail, patrón general)

### 1.1 ¿Tool o context provider?

Miré el shape real de un context provider (`packages/context-sdk/src/index.ts`):
```ts
export type ContextProvider = {
  id: string;
  assemble(ctx: ContextProviderContext): Promise<ContextBlock[]>; // sin args, sin resultado accionable
};
export type ContextBlock = { role: "system"; content: string; ... }; // texto, se inyecta siempre
```
Un context provider **no recibe argumentos y no puede escribir nada** — solo devuelve bloques de texto que se inyectan como contexto de sistema en cada turno, sí o sí, esté o no relacionado con lo que el usuario preguntó (así funcionan `prompt-files`/`project-context`/`memory-db`/`memory-local`, los precedentes que citó el usuario — inyección de fondo, no una acción bajo demanda).

**"Agregame un evento" es una escritura explícita bajo demanda — no encaja ahí.** Eso es un tool, no un context provider: necesita args (`{title, start, end, ...}`), un resultado que el LLM pueda leer y narrar de vuelta, y pasar por el approval gate igual que cualquier otra escritura (el mismo criterio que ya se aplicó a `fs.write` — una escritura ignora `approvalMode` si no pasa por el gate correcto). "Leé mis correos" es más ambiguo — *podría* ser un context provider (inyectar los últimos N mails no leídos como fondo, útil pasivamente) pero como acción explícita bajo demanda ("buscá el mail de tal cosa") es lo mismo: un tool con args (`gmail_search({query})`), no un blob de contexto siempre presente.

**Conclusión: son tools, no context providers.** Un context provider liviano tipo "agenda de hoy" queda anotado como posible complemento a futuro (sección 5), no parte de v1.

### 1.2 ¿Device-tool (`phone_*`) o server-side?

Los device-tools existen porque la acción **solo puede correr en el cel** — abrir una app instalada ahí, mostrar el picker SAF del sistema operativo Android, listar apps de ese dispositivo puntual. Google Calendar/Gmail no tienen esa restricción — son APIs REST de Google, corren exactamente igual desde la Mac que desde el cel, no hay ninguna capacidad "solo Android" en juego.

**Recomendación: server-side, mismo patrón que `tool-system`/`tool-documents`.** Un paquete nuevo (ej. `packages/tool-google`, ver 1.4) que registra `AgentToolDefinition[]` en el mismo `tools-runtime` que ya usan `fs.*`/shell/agent-tools — cero protocolo nuevo, reusa 100% del tool-loop/approval-gate existente. Ventaja de yapa: al vivir en el gateway, estos tools quedan disponibles para **cualquier cliente conectado** (desktop o cel vía gateway/Tailscale), no solo para el cel — a diferencia de los `phone_*`, que por definición son exclusivos de esa conexión.
- **Consecuencia para modo standalone** (`remote-access-analysis.md` §1.1): los conectores **no están disponibles ahí** — standalone no tiene gateway al que pegarle. **Nota 2026-09-05**: la premisa "standalone se mantiene limitado a tools `safe`, sin approval loop" ya no es cierta desde que se agregaron `phone_set_alarm`/`phone_set_timer`/`phone_add_calendar_event` (`moderate`) — standalone va a tener un gate local mínimo de todos modos (ver `remote-access-analysis.md` §7.2). Sigue en pie que los conectores no entran a standalone en este análisis — pero ya no es "porque standalone no tiene ningún gate", ahora sería porque no tienen gateway al que pegarle, motivo suficiente por sí solo.

### 1.3 OAuth — dónde corre, dónde vive el token

**Token: gateway/Mac, nunca el cel.** Mismo criterio que ya se aplicó a `providers.*.apiKey` (`config.get` lo enmascara antes de devolverlo, `packages/config/src/sanitize.ts:50` — el cel nunca puede leer una key real ni aunque se la pida). Un refresh token de Google en el cel sería, además, un secreto de larga vida guardado en un dispositivo mucho más fácil de perder/robar que la Mac — no hay motivo para exponerlo ahí.
- **Config nuevo, mismo patrón que `channels`** (`packages/config/src/index.ts:78`, `channels?: Record<string, {enabled?, accounts?: Record<string, unknown>}>`): agregar un namespace `connectors?: Record<string, {enabled?, accounts?: Record<string, unknown>}>` con la misma forma — `connectors.google.accounts.default = {refreshToken, scopes, connectedAt}`. `sanitizeAccounts` (`sanitize.ts:10-25`) ya enmascara genéricamente `token`/`botToken`/`apiKey` por cuenta — agregarle `refreshToken` a esa lista es el único cambio que hace falta para que esto quede protegido igual que todo lo demás, no hay que inventar un mecanismo de sanitización nuevo.
- **Dónde corre el consentimiento (la pantalla de "Iniciar sesión con Google")**: acá sí hay una decisión real, dos opciones:
  - **(a) Iniciado desde la Mac (desktop)**: patrón estándar de Google para apps de escritorio — la Mac levanta un servidor loopback efímero, abre el navegador del sistema con la URL de consentimiento, Google redirige a `http://127.0.0.1:<port>/callback` con el code, la Mac lo canjea por tokens y los guarda en `connectors.google.accounts.default`. Cero protocolo nuevo hacia el cel.
  - **(b) Iniciado desde el cel**: el cel abre el navegador/webview, completa el consentimiento, y manda el resultado (code o tokens) de vuelta al gateway por la conexión ya establecida — hace falta un método nuevo tipo `connectors.google.authUrl`/`connectors.google.completeAuth({code})`, pero el token final igual termina guardado solo en el gateway, nunca persistido en el cel.
  - **Recomendación: soportar (b)** — dado que todo este proyecto apunta a que el cel sea un cliente de primera clase (no un accesorio que obliga a volver a la Mac para cualquier setup), tiene sentido que conectar Google se pueda hacer desde el teléfono. El token sigue viviendo únicamente en el gateway en cualquiera de los dos casos — la diferencia es solo desde dónde se dispara el flujo, no dónde se guarda el resultado.

### 1.4 Patrón general de "conector externo" (no solo Google)

Para que el próximo conector (ej. Notion, que ya aparece en la lista de MCP tools del sistema — o cualquier otro) no tenga que reinventar esto:
- **Un paquete por proveedor** (`packages/tool-google`, no `packages/tool-connectors` genérico) — cada uno registra sus propios `AgentToolDefinition[]` con `riskLevel` seteado directo en el código (igual que `tool-system`/`tool-documents` — **no** hace falta el mecanismo de mapping-por-nombre que sí hizo falta para `phone_*`, porque ese mapping existía específicamente para no confiar en un cliente remoto no confiable declarando su propio riesgo; un paquete de conector vive en este repo, revisado, mismo nivel de confianza que cualquier tool server-side existente).
- **Config namespace compartido** `connectors.<id>.accounts.<accountId>` — misma forma para todos, reusa `sanitizeAccounts` sin cambios por conector (solo hay que sumar los nombres de campo secreto nuevos, ej. `refreshToken`, a la lista que ya enmascara `token`/`botToken`/`apiKey`).
- **Dos métodos gateway por conector** siguiendo la misma convención de nombres: `connectors.<id>.authUrl` (arranca el flujo, devuelve la URL de consentimiento) y `connectors.<id>.completeAuth` (recibe el code, hace el exchange, guarda el token). El resto de los tools del conector (`gcal_list_events`, `gcal_create_event`, etc.) son tools normales, no necesitan método propio.
- **Riesgo por tipo de operación, no por conector** — mismo criterio en todos: lecturas `"safe"` (mismo criterio que `fs.read`), escrituras con efecto real pero reversible `"moderate"` (crear un evento — se puede borrar, pero ya generó una notificación/invitación real a otras personas), acciones difíciles de revertir o visibles hacia afuera sin vuelta atrás `"destructive"` (ej. mandar un mail — no está en el set propuesto para v1, pero si algún día se agrega `gmail_send`, va ahí).

**v1 propuesto, acotado, no todo lo que Google Calendar/Gmail podrían hacer**: `gcal_list_events` (safe), `gcal_create_event` (moderate), `gmail_search`/`gmail_read` (safe). Nada de `send`/`delete` todavía — no fue pedido, y son las operaciones de mayor riesgo real.

## 2. Tema 2 — Gap real: "creá una alarma" solo pudo abrir la app

### 2.1 Lo que reveló mirar el código: no hace falta un patrón nuevo

Miré `MainActivity.kt` — `phone_open_app` ya funciona disparando un `Intent` (`startActivity(launchIntent)`, línea ~54), y `phone_search_files`/`phone_list_documents` ya disparan intents del sistema con extras (`Intent.ACTION_OPEN_DOCUMENT`/`ACTION_OPEN_DOCUMENT_TREE`, líneas 86/126). **"Crear una alarma sin abrir la UI manual" es exactamente el mismo mecanismo, con otro intent** — `Intent(AlarmClock.ACTION_SET_ALARM)` con extras (`EXTRA_HOUR`, `EXTRA_MINUTES`, `EXTRA_MESSAGE`, etc.) es una API pública de Android pensada específicamente para que apps de terceros creen alarmas sin ser la app de reloj. `AlarmClock.ACTION_SET_TIMER`/`ACTION_SHOW_ALARMS` son primos del mismo mecanismo.

**No hace falta ningún patrón nuevo de "device tools que ejecutan intents con parámetros"** — eso ya es lo que hace `phone_open_app` hoy, solo que con un intent bien simple (`ACTION_MAIN`/`CATEGORY_LAUNCHER`, sin extras). El gap no es arquitectónico, es de **contenido**: faltan entradas en `device_tool_specs.dart` + Dart + Kotlin, no una capacidad nueva del sistema. Se agregan como 2 `phone_*` más, mismo molde exacto que los 4 existentes:
- `phone_set_alarm` — `{hour, minute, label?}` → `Intent(AlarmClock.ACTION_SET_ALARM)`.
- `phone_set_timer` — `{seconds, label?}` → `Intent(AlarmClock.ACTION_SET_TIMER)`.
- `kind`: recomiendo `"interactive"` por default, no `"sync"` — varias apps de reloj (según el OEM/versión) muestran una pantalla de confirmación antes de guardar en vez de crearla en silencio, mismo comportamiento no garantizado que ya se documentó para otros intents del sistema. **Confirmar contra el Samsung real** (mismo criterio que ya se usó para clasificar `phone_search_files`) antes de cerrar esto como `"sync"` — si en la práctica ese dispositivo la crea sin ninguna pantalla, `"sync"` sería válido y más simple; si muestra confirmación, tiene que ser `"interactive"`.
- **`riskLevel: "moderate"` — CERRADO Y FINAL (Architect, contradicción real encontrada por Backend, ver §6 abajo).** No es `"safe"` por analogía directa con los 4 tools existentes — la sección 1.4 ya daba el criterio correcto (escritura persistente sin checkpoint humano) y acá se aplicó mal. Detalle completo en §6 — incluye por qué `kind` para este tool específico nunca puede terminar en `"interactive"` (no hay ambigüedad que resolver contra el device, es estructural).

### 2.2 Bonus encontrado, no pedido: hay un tercer camino para calendario, sin OAuth

Buscando el intent de alarma encontré que Android tiene el mismo tipo de mecanismo para calendario: `Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)` con extras (`TITLE`, `EVENT_LOCATION`, `BEGIN_TIME`, `END_TIME`) crea un evento **en el calendario local del dispositivo** (usa la cuenta que ya esté configurada en la app de Calendario del cel — sea Google, Outlook, lo que sea) **sin ningún OAuth propio** — el sistema operativo ya tiene el permiso, la app solo dispara el intent.
- **Contra el conector de Google Calendar (Tema 1)**: el intent nativo es de una sola vía — crea, no puede después listar/consultar/editar esos eventos (`ACTION_INSERT` abre una UI y termina ahí, no hay API de lectura de vuelta), y solo escribe en la cuenta/calendario que el usuario tenga configurada como default en el cel. El conector Google Calendar (API real + OAuth) sí permite `list/create/query`, funciona igual desde desktop, y no depende de qué calendario esté configurado en ese teléfono puntual.
- Queda anotado como una opción más para el v1 mínimo de "calendario", no como reemplazo del conector — ver recomendación en sección 3.

## 3. Comparación y prioridad — ¿conviene uno antes que el otro?

**Complementarios, no competencia — pero para el pedido concreto del usuario ("alarma"), el intent nativo es la respuesta correcta y ya alcanza, no hace falta ningún conector para eso.** Una alarma no tiene ni tuvo nunca un equivalente en la nube razonable (no es una cuenta de Google la que "recuerda" que a las 7 tenés que levantarte, es el reloj del propio cel) — el intent nativo no es un parche corto-placista acá, es la solución correcta y final para ese caso puntual.

Regla general para decidir, no solo para hoy:
- **¿La acción tiene sentido sin cuenta en la nube, y solo importa en ESTE dispositivo?** → intent nativo (alarma, timer, marcar/llamar un número, abrir navegación en Maps con una dirección). Cero OAuth, cero setup, se agrega tan rápido como se investiga el intent correcto.
- **¿La acción necesita leer datos de vuelta, funcionar desde cualquier dispositivo, o el servicio ya es inherentemente de nube sin alternativa local (mail no tiene "intent nativo" razonable — es de por sí un servicio remoto)?** → conector server-side (Tema 1).
- **¿Es "crear un evento de calendario" específicamente?** → zona gris real, las dos sirven. Recomiendo el intent nativo (`ACTION_INSERT` de `CalendarContract`) como fix rápido de v1 si el pedido es solo "agregame esto a mi calendario" — mismo costo que la alarma, cero infraestructura de OAuth — y el conector completo de Google Calendar como la solución robusta si además se quiere "qué tengo hoy"/"movéme la reunión de las 3", que el intent no puede resolver.

**Prioridad sugerida, no vinculante**: (1) `phone_set_alarm`/`phone_set_timer` — arregla el bug reportado, costo mínimo, ya está todo el molde armado. (2) `phone_add_calendar_event` (intent nativo) si "agendame algo" es un pedido frecuente y alcanza con crear, sin necesitar consultar después. (3) Conector Google Calendar/Gmail completo — más trabajo (OAuth, config nuevo, dos tools de lectura), se justifica cuando se quiera *consultar* la agenda o el mail, no antes.

## 4. Recomendación consolidada (no implementar todavía)

1. `phone_set_alarm`/`phone_set_timer` — mismo molde que los 4 `phone_*` existentes, sin protocolo nuevo. Confirmar `kind` contra el Samsung real antes de cerrar `"sync"` vs `"interactive"`.
2. `phone_add_calendar_event` (intent nativo, sin OAuth) — mismo molde, si el caso de uso de calendario es "crear", no "consultar".
3. Conector Google (paquete `packages/tool-google`, namespace de config `connectors.google`, dos métodos de OAuth por conector + tools normales para `list/create/search`) — sección 1.4 deja el patrón general para que el próximo conector lo reuse.
4. Conectores quedan **fuera de standalone** (§1.2) — solo disponibles en modo gateway.

## 5. Abierto

1. ¿"Leé mis correos" apunta a una acción bajo demanda (`gmail_search`, lo que recomienda este doc) o a algo más ambiental tipo "avisame si me llegó algo importante" (eso sí sería un context provider liviano, o directamente un feature de notificaciones aparte — no cubierto acá)?
2. ¿El conector Google se limita a Calendar+Gmail, o entra Drive/Contacts en el mismo paquete? No hay pedido explícito de esos todavía — no los incluyo en v1.
3. OAuth iniciado desde el cel (§1.3-b): necesita que el gateway sea alcanzable desde el cel para completar el flujo — en la práctica esto normalmente ya es cierto (LAN/USB/Tailscale), pero si el usuario intenta conectar Google estando en modo standalone (sin gateway), el flujo no tiene dónde guardar el token — hay que decidir si eso se bloquea con un mensaje claro ("conectate a tu gateway primero") o si tiene sentido en algún caso soportar guardarlo también client-side para standalone (rompería el criterio de "token nunca en el cel" de §1.3 — no lo recomiendo, pero lo anoto porque standalone + conector es una combinación que hoy no tiene respuesta).

## 6. Corrección — contradicción real en el criterio de riskLevel (Architect, 2026-09-04, encontrada por Backend)

Backend encontró que §1.4 (criterio general: "escritura con efecto real pero reversible → `moderate`") y §2.1 (`phone_set_alarm: riskLevel "safe"`) se contradicen — una alarma es exactamente una escritura con efecto real y reversible.

**La sección 2.1 estaba mal, no la 1.4.** Clasifiqué `phone_set_alarm` por analogía reflejo con los 4 tools existentes en vez de re-derivar del criterio real. El criterio que de verdad separa `safe` de lo que necesita approval, mirando por qué cada uno de los 4 tools existentes es `safe`:
- `phone_open_app`/`phone_list_installed_apps`: sin escritura persistente, o efecto visible/reversible en el instante (el usuario ve la app abrirse).
- `phone_search_files`/`phone_list_documents` (`interactive`): el picker SAF **es** el checkpoint humano — no hay ningún camino donde el LLM obtenga resultado sin que un humano haya tocado la pantalla primero.

`phone_set_alarm` como `kind:"sync"` no cumple ninguna de las dos — escribe estado persistente, y si el clock app lo guarda en silencio (comportamiento real de varios OEM/AOSP), cero humano lo tocó antes de que exista. Mi justificación original de `"moderate"` en 1.4 apuntaba a "afecta a terceros" (una invitación de calendario) — eso no aplica a una alarma, es 100% local — pero eso no la baja a `safe`: el criterio que importa es "escritura persistente sin checkpoint humano", y una alarma cae ahí igual.

**Corrección, primera pasada: `riskLevel` depende del `kind` real, no es un valor fijo** — `sync` → `moderate` sin excepción, `interactive` (clock app confirma antes de guardar) → `safe`, misma lógica que `search_files`/`list_documents`. Arrancar con `moderate` (fail-closed) hasta confirmar `kind` contra el Samsung real.

**Precisión de Frontend que cierra esto del todo, sin condicional (Backend, mismo hilo, confirmado en código — `MainActivity.kt:169-179`): `kind` para `phone_set_alarm` nunca puede salir `"interactive"`, no es cuestión de esperar a ver qué hace el Samsung.** `ACTION_SET_ALARM` se dispara con `startActivity` plano, no `startActivityForResult` (a diferencia de `ACTION_OPEN_DOCUMENT` de `search_files`, que sí usa `onActivityResult`) — no hay ningún contrato de resultado hacia la app llamante, nada que el lado Dart pueda awaitear o cancelar. Es estructural, no una cuestión de qué pantalla decida mostrar el clock app instalado. Sumado a que decidieron **no** usar `EXTRA_SKIP_UI` a propósito (transparencia — el usuario sí ve/confirma en la app de reloj antes de que se guarde), la regla condicional de arriba nunca tiene la rama `"interactive"` disponible para este tool específico.

**`riskLevel: "moderate"` queda entonces cerrado y final para `phone_set_alarm`/`phone_set_timer`** — no un placeholder a la espera de una prueba en el device, el resultado práctico ya no puede ser otro.

## 7. `phone_add_calendar_event` — riskLevel, y un hallazgo que rompe una asunción implícita de la sección 6

Backend investigó (docs oficiales de Android + corroboración externa) y confirmó: `ACTION_INSERT` sobre `Events.CONTENT_URI` **siempre** abre el editor de eventos de la app de Calendario — no existe, ni documentado ni observado, un path de guardado silencioso equivalente al de `ACTION_SET_ALARM` (que sí varía por OEM). El usuario tiene que tocar Guardar para que el evento exista.

**Hallazgo real: `kind` y "existe checkpoint humano" quedan desacoplados para este tool** — algo que la sección 6 asumía implícitamente acoplado (ahí, `kind:"sync"` ⇔ sin checkpoint, `kind:"interactive"` ⇔ con checkpoint, porque para `phone_set_alarm` ambas cosas coincidían). Acá `kind` sigue siendo `"sync"` (mismo motivo técnico que la alarma: `startActivity` sin `onActivityResult`, nada que el lado Dart pueda awaitear) **pero el checkpoint humano existe igual, garantizado por la plataforma** — el código no lo espera, pero Android no deja completar la acción sin él. Vale la pena que quede anotado como principio general: `kind` es sobre *qué necesita orquestar el cliente* (esperar o no un resultado), no es un proxy confiable de "hay o no humano en el medio" — para los tools de picker (`search_files`/`list_documents`) coincidían por casualidad de implementación (SAF sí usa `onActivityResult`), no por regla.

**¿Eso lo baja a `safe`, mismo criterio que `search_files`/`list_documents`?** No — confirmo `"moderate"`, y la razón es la misma que ya until yo para la alarma, aplicada en la dirección contraria: el criterio que decide `safe` no es "¿existe una pantalla de confirmación?", es **"¿la confirmación de esa pantalla deja completamente clara y contenida la consecuencia real de la acción?"**. En `search_files`, tocar un archivo en el picker **es** literalmente la totalidad del riesgo — no hay nada más que decidir. En el editor de eventos, tocar Guardar no necesariamente le hace evidente al usuario que esa cuenta default puede ser una compartida/laboral y que eso dispara una invitación real a otras personas — el checkpoint existe, pero no es transparente sobre su propio alcance. Ese es el límite real de "`safe`": la consecuencia tiene que quedar completamente adentro del dispositivo/decisión del usuario, sin importar cuántas pantallas la protejan — en el momento en que puede llegarle a un tercero, sale de esa categoría.

**Cerrado: `phone_add_calendar_event` → `riskLevel: "moderate"`.**

---
Generado con Claude Code — sesión: https://claude.ai/code/session_0116JqfBKympUw3Xhmr2ZVu4
