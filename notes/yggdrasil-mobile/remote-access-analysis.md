# Análisis: acceso remoto (fuera de LAN/USB) + selección de proveedor LLM

Estado: **análisis, sin implementar** — a pedido explícito del usuario. Nada de esto se toca en código todavía.
Basado en: `notes/yggdrasil-mobile/phone-gateway-connectivity-design.md` (diseño LAN/USB, ya cerrado y confirmado funcionando end-to-end vía adb reverse) + lectura del código actual (`packages/config/src/auth.ts`, `packages/gateway/src/server.ts`, `packages/app-desktop/src/main/gateway.ts`, `packages/kernel/src/registry.ts`, `packages/provider-*`).
Fecha: 2026-09-04 (actualizado dos veces: (1) Tailscale ya instalado en ambas puntas, Anthropic/Claude confirmado TODO; (2) **respuesta a "¿Mac apagada?": SÍ hace falta modo standalone**, pero acotado a **cambio manual de perfil**, no auto-failover — reduce bastante el scope respecto a lo que sección 1 dejaba abierto, ver sección 1.1 nueva y sección 5/6 actualizadas).

## 0. Qué cambió respecto al diseño anterior

El diseño anterior resolvía "cel enchufado por USB, misma máquina" (opción b, ya funcionando en el Samsung real) y dejaba LAN bind (opción a) como plan mediano plazo, bloqueado por el gap de approval en `fs.*` (todavía no cerrado en código, sigue como prerequisito). La opción c (relay) se descartó ahí explícitamente: *"sin caso de uso remoto declarado, es complejidad sin beneficio."*

Ese caso de uso ahora existe: el cel tiene que andar **fuera de casa**, sin compartir red con la máquina del gateway, hablando con:
- Ollama local (`127.0.0.1:11434` de esta Mac) — solo alcanzable si el cel llega a esta red/máquina.
- Un proveedor autohosteado — mismo problema.
- Proveedores cloud (Claude/Anthropic, OpenAI, Ollama Cloud) — alcanzables directo desde cualquier red con internet, no dependen de llegar a la Mac.

Esto reabre la sección 2c del doc anterior, pero la reabre con una pregunta previa que hay que resolver primero (sección 1) antes de discutir *cómo* hacer el relay — porque para los proveedores cloud puede que no haga falta relay en absoluto.

## 1. Pregunta de fondo: ¿todo pasa por el gateway, o el cel le puede hablar directo a un proveedor cloud?

Hoy **toda** la arquitectura pasa por `methods.ts`/`chat.send` en el gateway: sesiones (`sessions.*`), tools server-side (`tool-system`, vía `tools-runtime`), device-tools + approval loop (todo lo diseñado en el doc anterior), historial persistido (`SessionStore`). El cel es un cliente WS delgado — no tiene tool-loop propio, no decide nada, solo ejecuta lo que el gateway le pide y muestra lo que el gateway le manda.

Para un proveedor cloud, esa arquitectura **no es necesaria por motivos de alcance de red** — Claude/OpenAI/Ollama Cloud son alcanzables desde cualquier lado con internet, la app podría tener su propia key y pegarle directo a la API del proveedor sin pasar por la Mac en absoluto. Esto abre dos modos genuinamente distintos, no una gradación del mismo modo:

### Modo conectado (vía gateway, remoto)
El cel sigue siendo el mismo cliente WS delgado de siempre — solo cambia cómo *llega* al gateway (LAN hoy, algo nuevo para remoto, sección 3). Se mantiene:
- Historial compartido con desktop (mismo `sessionKey`, misma `SessionStore`).
- Device-tools + approval loop tal como están diseñados.
- Tools server-side (`fs.*`, shell, lo que sea que corra en la Mac).
- Un solo tool-loop (`harness-llm/tool-loop.ts`), una sola implementación, cero duplicación.
- Funciona **igual para los 4 casos de proveedor** (cloud o local) — porque quien habla con el proveedor siempre es el gateway, nunca el cel, y el gateway ya sabe hablar con cualquiera de los 4 vía `resolveProviderConfig`/`provider-openai-compat`/`provider-ollama` (`packages/config/src/index.ts:168`).
- **Requiere que la Mac esté prendida y el gateway corriendo.** Si la Mac está apagada, esto no funciona para nada — ni para local ni para cloud.

### Modo standalone (cel habla directo al proveedor cloud, sin gateway)
El cel tendría su propia key de Claude/OpenAI/Ollama Cloud (nunca la del gateway — `config.get` ya sanitiza/enmascara `providers.*.apiKey` antes de devolverlo, `packages/config/src/sanitize.ts:50`, así que el cel no puede ni sacarle la key a la Mac aunque quisiera) y le pegaría directo a la API del proveedor. Esto **no es un simple cambio de transporte** — implica re-implementar en el cliente Flutter una porción real de lo que hoy vive en `harness-llm/tool-loop.ts`: parsear el streaming de tool-calls del proveedor, correr device-tools localmente, correr una approval UI local, mandar el tool-result de vuelta al proveedor. Es una segunda implementación del tool-loop, en otro lenguaje, con el riesgo de que diverja de la de `harness-llm` con el tiempo (un fix en una no llega a la otra).
- Se pierde: historial compartido con desktop, tools server-side (`fs.*`, shell — a menos que también se reimplementen, lo cual no tiene sentido para un cel), sesiones persistidas del lado gateway.
- Se gana: **funciona con la Mac completamente apagada** — porque no depende de ella en absoluto.

### Por qué esto importa para la decisión de relay
Un relay (sección 3) resuelve *"el cel no comparte red con la Mac"*. **No resuelve *"la Mac está apagada"*** — no hay nada que relayar si el proceso gateway no está corriendo. Esa es la única razón real para considerar el modo standalone: si "andar fuera de casa" en la práctica también incluye "sin que la Mac esté prendida", el relay no alcanza para cloud tampoco, y ahí sí standalone-para-cloud tiene un caso de uso genuino (no aplica a Ollama local/autohosteado bajo ningún modo — esos necesitan la máquina que los corre, prendida y alcanzable, sí o sí).

**Recomendación**: construir el modo conectado remoto (relay, sección 3) como la respuesta para los 4 casos de proveedor — es uniforme, reusa el 100% del protocolo/tool-loop existente, y cero código nuevo del lado del proveedor. Tratar el modo standalone como una feature aparte, materialmente más grande (segundo tool-loop cliente-side), que **solo vale la pena si "funcionar con la Mac apagada" es un requisito real y explícito** — no algo que se construye de arrastre porque "para cloud se podría". Esto es una decisión de producto, no técnica — la dejo abierta en sección 6, no la resuelvo acá.

### 1.1 Respuesta del usuario: standalone SÍ hace falta, pero acotado a selección manual de perfil (no auto-failover)

Respuesta textual: *"no, la Mac no siempre va a estar prendida, pero en caso de no estar prendida, debo poder cambiar a otra config que yo haya guardado, como algún provider cloud."*

Esto confirma la rama que sección 1 dejaba condicionada — hace falta modo standalone. Pero el matiz importa y **reduce el scope real**: es **cambio manual a una config guardada**, no detección automática de "el gateway no responde → failover". Eso saca de la mesa el problema más difícil que este análisis dejaba implícito (¿cómo detecto de forma confiable que la Mac está apagada/inalcanzable vs. un simple timeout de red transitorio? ¿reintento cuánto antes de decidir fallback? ¿qué pasa si el gateway vuelve a estar disponible a mitad de conversación?) — nada de eso hay que resolverlo, porque el usuario elige a mano, no hay lógica de detección.

Con esa acotación, el diseño (siempre a nivel análisis, no implementación) queda así:

- **Concepto nuevo en el cliente: "perfil de conexión"**, no solo un `baseUrl`+`apiKey` único como hoy. Cada perfil es uno de dos tipos:
  - `{tipo: "gateway", baseUrl, apiKey}` — el modo de siempre (LAN, USB, o Tailscale una vez configurado). Puede haber más de uno guardado (ej. "Gateway de casa vía Tailscale").
  - `{tipo: "provider-directo", provider: "anthropic"|"openai"|"ollama-cloud", apiKey, model?}` — modo standalone, la key es del usuario, nunca la del gateway (`config.get` ya la enmascara del lado gateway de todos modos — sección 1).
- **Selector manual en la UI** — el usuario elige qué perfil está activo; vive naturalmente en el drawer de configuración que ya existe (`main.dart`, "Configurar API URL"/"Configuración de Agente" — mismo lugar que la UX de mobile-chat-ux-flows.md §1.2 ya reubicó bajo el overflow de Chat list). No hace falta ningún mecanismo de reconexión/reintento automático entre perfiles.
- **Una sesión/chat queda atada al perfil bajo el que se creó, no migra entre modos**: un chat creado en modo gateway vive en `SessionStore` del lado servidor (via `sessions.list`) y no es alcanzable en modo standalone (el cel no tiene cómo preguntarle al gateway por él si no está conectado — no hay nada que "resolver" ahí, es una consecuencia directa de que standalone no tiene gateway al que preguntarle). Un chat creado en modo standalone vive solo localmente en el cel. Esto es aceptable dado que el cambio es manual y explícito: el usuario ya sabe que está en "modo Claude directo" cuando arranca un chat ahí.
- **Simplificación real que no estaba clara en la primera pasada**: el costo de reimplementar el tool-loop cliente-side (sección 1, ya identificado) baja bastante si el set de tools disponible en standalone se mantiene limitado a los 4 `phone_*` de hoy — **los cuatro son `riskLevel:"safe"`** (mapping ya cerrado del lado gateway, punto 6 de `phone-gateway-connectivity-design.md`). Si standalone nunca expone tools server-side (`fs.*`, shell — ya excluidos, viven en la Mac) y se mantiene solo con los `phone_*` `safe`, **no hace falta reimplementar el approval loop en absoluto para v1 de standalone** — todo tool disponible ahí corre sin pedir aprobación, igual que pasa hoy en modo `auto` contra el gateway. La parte que sí hay que construir en el cliente es más chica de lo que sonaba: parsear el streaming de tool-calls del proveedor + ejecutar los 4 `phone_*` localmente + mandar el tool-result de vuelta — sin UI de approval, sin `approvalMode`, sin riesgo de que esa lógica diverja de `tool-loop.ts` en el caso que más importa (el approval gate, que es la parte con implicancia de seguridad real). **Esto deja de ser cierto en el momento en que a standalone se le sume un tool con riesgo real** — ya pasó (`phone_set_alarm`/`phone_set_timer`/`phone_add_calendar_event`, todos `moderate`), ver corrección y gate mínimo requerido en §7.2.

**Hallazgo aparte, no bloqueante para este análisis pero relevante para el alcance**: no existe todavía un provider plugin de Anthropic/Claude en el runtime — `packages/kernel/src/registry.ts` solo tiene `provider-openai-compat` y `provider-ollama` registrados (confirmado, `grep -rln "registerProvider\|ProviderPlugin = {"` no encuentra un tercer paquete). "Ollama Cloud" hoy se resuelve como un modelo más de `provider-openai-compat` apuntado a su endpoint OpenAI-compatible (`provider-openai-compat/src/provider.ts:18`, `"GPT-OSS 120B (Ollama Cloud)"`), pero Claude/Anthropic no tiene ningún path hoy, ni server-side ni standalone. Esto es un gap de integración de proveedor, independiente de todo lo de conectividad — vale la pena que quede anotado para que no se asuma resuelto.

## 2. Reevaluación de la sección 2c del doc anterior (relay)

La razón de descarte ("sin caso de uso remoto declarado") ya no aplica — hay caso de uso real. Pero "relay" no es una sola cosa; hay tres formas distintas de resolver "el cel llega a la Mac aunque no compartan red", con costos muy distintos. Reemplazo la vieja sección 2c por el análisis de la sección 3.

## 3. Transporte para el modo conectado remoto — opciones

### a. Mesh VPN (Tailscale u equivalente) — recomendado, **ya instalado en ambas puntas**
- **Confirmado por el usuario**: Tailscale ya está instalado y configurado tanto en el cel como en esta Mac — no es un paso de setup pendiente, es infraestructura que ya existe hoy. Esto elimina de raíz el único contra real que tenía esta opción (fricción de instalar+configurar en dos dispositivos). Lo único que falta del lado de este proyecto es configuración del gateway/cliente (ver abajo), no instalar nada nuevo.
- **Cómo**: Mac y cel ya están en la misma red privada (WireGuard por debajo). El cel alcanza la Mac por su IP/hostname de Tailscale **exactamente igual que si estuvieran en la misma LAN** — mismo `ws://<tailscale-ip>:<port>`, mismo protocolo, cero cambios en `methods.ts`/`server.ts`. La única diferencia con LAN bind (opción 2a del doc anterior) es a qué interfaz bindea el gateway (la de Tailscale en vez de la LAN física) y qué IP/hostname guarda el cel como `baseUrl`. Eso sí queda como trabajo de implementación (no hecho todavía, este doc sigue siendo solo análisis): bindear `HOST` en `packages/app-desktop/src/main/gateway.ts:9` a la IP de Tailscale de la Mac (hoy hardcodeado a `127.0.0.1`) y actualizar el `baseUrl` guardado en el cliente Flutter para apuntar ahí.
- **Por qué es la opción más simple de las tres**: NAT traversal (relevante porque la mayoría de las redes hogareñas están detrás de CGNAT/IP dinámica, no se puede simplemente "abrir un puerto") ya está resuelto por Tailscale — no hay que construir ni operar nada propio. Cero código de relay nuevo en este repo.
- **Ventaja práctica sobre un túnel/relay propio**: el cel no necesita saber si está "en casa" o "afuera" — la IP de Tailscale de la Mac es la misma en ambos casos (con MagicDNS, hasta el mismo hostname). Esto elimina toda la lógica cliente de "¿estoy en LAN o remoto, a qué URL le pego?" — un solo `baseUrl` sirve siempre.
- **Seguridad**: la red de Tailscale ya es privada (solo los dispositivos del usuario, autenticados contra su cuenta) — esto baja la urgencia de blindar el transporte a nivel app (TLS de `server.ts`, ver sección 4) porque WireGuard ya cifra todo el tráfico. **No reemplaza la auth de apiKey** (defensa en profundidad — no confiar solo en la capa de red, mismo criterio que ya se aplicó en todo este diseño), pero sí baja la urgencia de otros ítems de la sección 4.
- **Contras**: dependencia de un tercero (cuenta de Tailscale) — pero dado que ya está instalado y en uso en ambas puntas, esto ya no es un costo a pagar, es un hecho ya aceptado por el usuario.

### b. Túnel público (Cloudflare Tunnel / ngrok-like)
- **Cómo**: un proceso (`cloudflared` u otro) corre en la Mac, abre una conexión saliente hacia el borde del proveedor, y expone el puerto local bajo una URL pública estable (Cloudflare Tunnel) o efímera (ngrok free tier). El cel le pega a esa URL pública `wss://...` desde cualquier red.
- **Pros**: no requiere instalar nada en el cel (a diferencia de Tailscale) — es una URL pública común y corriente. Cloudflare Tunnel termina TLS en su borde, así que el tramo público ya viaja cifrado sin tocar el `tlsCfg` de `server.ts`.
- **Contras**: esto es genuinamente **exposición a internet público** — cualquiera que adivine/filtre la URL puede intentar conectarse (mitigado únicamente por la auth de apiKey, no por la red). Mucho mayor urgencia sobre todo lo de la sección 4 que con Tailscale. `ngrok` free tier además rota la URL en cada reinicio, mal fit para algo que el usuario quiere que "ande" de forma estable.
- **Cuándo preferirla sobre (a)**: si el usuario no quiere instalar Tailscale en el cel por algún motivo, o el objetivo es que un dispositivo *no controlado* por el usuario también pueda conectarse alguna vez (Tailscale asume que todos los dispositivos son del mismo usuario/cuenta).

### c. Relay propio autohosteado
- **Cómo**: un proceso servidor nuevo, en una VPS o similar, con IP pública — Mac y cel se conectan ambos *salientes* hacia ese relay (evita el problema de NAT sin depender de un tercero como Tailscale/Cloudflare), el relay empareja los dos streams por algún identificador.
- **Contras**: reinventa exactamente lo que (a) y (b) ya resuelven de forma robusta y gratuita/barata — hay que construir el relay, operarlo (uptime, updates, el propio auth del relay), y pagar/mantener una VPS. Sin ninguna ventaja concreta sobre (a) para el caso de uso descrito (proyecto personal, dispositivos propios del usuario) — solo tendría sentido si esto fuera un producto multi-tenant (no es el caso, `harness_pp` es una app personal/individual).
- **Recomendación: descartar**, mismo criterio que el descarte original de 2c pero ahora aplicado específicamente a "construirlo yo" — la necesidad de relay es real, pero no hace falta construirlo desde cero cuando (a) ya la resuelve mejor.

### Recomendación de sección 3
**(a) Tailscale, confirmado — ya instalado en Mac y cel, sin fricción de setup pendiente.** Cero código nuevo en el gateway, reusa 100% del protocolo, mínimo cambio de superficie de seguridad, y con ambas puntas ya en la misma tailnet lo único que queda es configuración (bindear el `HOST` del gateway a la interfaz de Tailscale, apuntar el `baseUrl` del cel ahí — sección 5). (b) Cloudflare Tunnel queda como alternativa solo si por algún motivo se dejara de usar Tailscale más adelante, con la auth de la sección 4 tratada como no-negociable en ese caso (ahí sí sería internet público de verdad). **(c) relay propio, descartado.**

## 4. Auth robusto — qué ya existe y qué falta

Punto de partida bueno, no hay que empezar de cero: `packages/config/src/auth.ts` **ya tiene multi-key con metadata** — `ApiKeyEntry = { key, name, expiresAt? }` (`auth.ts:3-7`), `resolveAllGatewayApiKeys`/`validateGatewayApiKey` ya soportan una lista de tokens nombrados con expiración individual, no un único secreto compartido. Esto es exactamente la primitiva que hace falta para "un token por dispositivo, revocable sin invalidar los demás" — no hace falta inventar nada nuevo acá, falta *usarlo* bien para el caso remoto:

1. **Query-param apiKey es mala práctica sobre internet público**, incluso con TLS — las URLs quedan en logs de proxies/servidores, historial, etc. (no es un problema nuevo de exposición del secreto en tránsito, es un problema de dónde queda *guardado* después). El protocolo ya tiene el mecanismo correcto para esto — el fallback `{method:"auth",params:{apiKey}}` que se confirmó en el diseño anterior (sección 1 de `phone-gateway-connectivity-design.md`) — **recomendación: para conexiones remotas, el cliente no debe mandar el apiKey en la query en absoluto, solo vía ese mensaje post-connect.** Cero cambio de protocolo, es una decisión de qué hace el cliente según si la conexión es LAN o remota.
2. **TLS existe pero está sin cablear** — `server.ts:77-92` ya tiene el `if (tlsCfg?.cert && tlsCfg?.key)` que levanta `https`/`wss` en vez de `http`/`ws`, pero `packages/app-desktop/src/main/gateway.ts` nunca setea `config.gateway.tls` y bindea siempre a `HOST = "127.0.0.1"` (línea 9) — hoy es una capacidad dormida, no algo "ya funcionando" que solo haga falta prender. Bajo Tailscale (opción 3a) esto es menos urgente (WireGuard ya cifra el transporte) — bajo Cloudflare Tunnel (3b) tampoco hace falta tocarlo (Cloudflare termina TLS en su borde) — sería necesario **solo** si en algún momento se expone un puerto directo sin ninguna de las dos capas de arriba, que ninguna opción recomendada de la sección 3 requiere.
3. **Falta UI de pairing/revocación** — la primitiva (`apiKeys[]` con `name`+`expiresAt`) está, pero no hay ninguna pantalla en desktop para generar un token nuevo por dispositivo ni para revocar uno (ej. cel perdido/robado). Es trabajo de UI sobre algo que ya existe en el config schema, no una feature nueva de auth.
4. **`fs.*` sin approval gate** (punto 2 de la sección 4 del doc anterior) — ya estaba marcado como bloqueante para LAN bind, con más razón para remoto/internet. Sigue sin implementarse en código (verificado, sigue igual). No cambia la recomendación, solo la urgencia.
5. **Concurrencia de `chat.send`** (punto 7 del doc anterior) — el gap de que no hay lock por `sessionKey` importa más cuanto más superficie de acceso remoto haya (más probabilidad de que dos clientes/reconexiones pisen la misma sesión). Mismo gap de siempre, ahora con más motivo para resolverlo antes de exponer esto más ampliamente.

**No creo necesario** forzar `approvalMode` a un valor más estricto solo por estar en modo remoto (ej. prohibir `yolo` fuera de LAN) — es una decisión del usuario sobre su propia configuración de confianza, y con Tailscale la conexión remota es tan "suya" como la LAN. Vale la pena que el usuario lo considere, no que el diseño se lo imponga.

## 5. Recomendación consolidada (no implementar todavía)

1. Modo conectado remoto vía **Tailscale** (sección 3a, **ya instalado en Mac y cel**) para los 4 casos de proveedor — extiende la opción 2a del doc anterior (LAN bind), no la reemplaza; el gateway sigue viendo "una IP más a la que bindear", cero protocolo nuevo. Sin paso de instalación pendiente — el trabajo que queda es bindear `HOST` (`packages/app-desktop/src/main/gateway.ts:9`) a la interfaz de Tailscale y apuntar el `baseUrl` del cliente ahí.
2. **Prerequisito duro, ya documentado, todavía no implementado**: cerrar `fs.*` con approval gate (punto 2, doc anterior) antes de habilitar esto — más cierto todavía para remoto que para LAN.
3. Cliente: para conexión remota, usar el fallback `{method:"auth"}` en vez de apiKey en la query (ítem 1, sección 4) — decisión de cliente, cero protocolo nuevo.
4. Desktop: agregar una pantalla mínima de "dispositivos pareados" (listar/revocar `apiKeys[]` por nombre) antes de que esto sea usable en la práctica más allá del propio autor probándolo.
5. **Modo standalone — CONFIRMADO en scope, acotado a selección manual de perfil (sección 1.1).** No auto-failover, no detección de "Mac caída" — el usuario elige el perfil a mano desde la config. Con el tool-surface limitado a los 4 `phone_*` (todos `safe`), v1 de standalone no necesita reimplementar el approval loop, solo: parsing del streaming de tool-calls del proveedor + ejecución local de esos 4 tools + envío del tool-result. Sí necesita: el concepto de "perfiles de conexión" guardados (gateway vs. provider-directo) + selector manual en la UI + manejo de que un chat queda atado al perfil bajo el que se creó (sin migración entre modos).
6. Proveedor Anthropic/Claude no existe en el runtime hoy (ningún modo) — sigue como TODO confirmado por el usuario, no se prioriza en este trabajo.

## 6. Abierto — decisiones de producto, no técnicas

1. ~~¿"Fuera de casa" incluye "con la Mac apagada"?~~ — **CONTESTADO: sí puede pasar, y el usuario quiere poder cambiar a mano a un perfil guardado (ej. provider cloud directo) en ese caso.** Modo standalone confirmado en scope, acotado a selección manual — sin auto-detección ni failover automático. Ver sección 1.1 para el diseño (acotado) y sección 5 para cómo queda la recomendación consolidada.
2. ~~¿Instalar Tailscale en el cel es aceptable?~~ — **CONFIRMADO por el usuario: aceptable, ya está instalado en ambas puntas (cel y Mac).** Sección 3a queda como la opción sin fricción de setup pendiente — ver actualización ahí y en sección 5.
3. ~~Prioridad del provider de Anthropic/Claude~~ — **CONFIRMADO por el usuario: queda como TODO, no se prioriza ahora.** No lo bloqueo ni lo resuelvo en este análisis — sigue anotado como gap conocido en sección 1, sin acción pendiente de mi parte hasta que el usuario decida retomarlo.

## 7. Contrato de implementación — perfiles de conexión (Architect, 2026-09-04, post-autorización)

Usuario autorizó implementar sección 5. Esto cierra los 4 puntos de contrato pa que Backend/Frontend arranquen sin adivinar nada. **No implementé nada yo** — esto es contrato, no código.

### 7.1 Shape de "perfil de conexión" (cliente Flutter)

```jsonc
// ConnectionProfile
{
  "id": "uuid-v4",                    // generado client-side al crear el perfil, estable
  "name": "Gateway de casa (Tailscale)", // label editable por el usuario, lo que ve en el selector
  "type": "gateway" | "direct",

  // type === "gateway":
  "baseUrl": "ws://100.x.x.x:PORT",   // scheme+host+port, SIN el apiKey en la query (sección 4, ítem 1
                                       // del análisis original — para remoto el apiKey va solo por el
                                       // fallback {method:"auth"}, nunca en la URL)
  "apiKey": "...",                    // token pareado — un ApiKeyEntry.key de auth.gateway.apiKeys
                                       // del lado gateway, no el legacy apiKey único compartido

  // type === "direct":
  "provider": "anthropic" | "openai" | "ollama-cloud",
  "apiKey": "...",                    // key propia del usuario pa ese proveedor — nunca sale del gateway,
                                       // config.get la enmascara igual (sanitize.ts:50), ni hace falta pedirla ahí
  "model": "...",                     // opcional; si no viene, default por proveedor

  "createdAt": 0,                     // epoch ms
  "lastUsedAt": 0                     // epoch ms, opcional — pa ordenar el selector por uso reciente
}
```

- **Persistencia**: mismo mecanismo que hoy (`SharedPreferences`, prefijo `yggdrasil_pref_` ya existente en `yggdrasil_client.dart:5`), no un store nuevo. Dos keys nuevas:
  - `${_prefPrefix}connection_profiles` → lista de `ConnectionProfile` serializada como JSON.
  - `${_prefPrefix}active_profile_id` → el `id` del perfil activo.
- **Migración**: hoy existe un solo `baseUrl`+`apiKey` guardado (`_baseUrlKey`, campo `apiKey` del constructor). Al primer arranque post-update: si hay `baseUrl` guardado y todavía no existe `connection_profiles`, crear automáticamente un perfil `type:"gateway"` con esos valores (nombre default: "Mi gateway"), marcarlo activo, y ahí termina la migración — no hay que tocar más nada de lo existente ni pedirle al usuario que reconfigure de cero.
- El selector en la UI (drawer de config, mismo lugar que hoy — `mobile-chat-ux-flows.md` §1.2) lista los perfiles guardados + un "+" pa crear uno nuevo de cualquiera de los dos `type`. Cambio de perfil es 100% manual, sin ningún intento de reconexión/fallback automático — así quedó confirmado por el usuario.

### 7.2 Tool-loop standalone — set de tools y llamada sobre `search_files`/`list_documents`

Los 4 `phone_*` de v1 (no 3 — completo: `phone_open_app`, `phone_list_installed_apps`, `phone_search_files`, `phone_list_documents`), todos `riskLevel:"safe"` según el mapping ya cerrado (`methods.ts:155-160`).

**Mi llamada: los 4 entran en standalone v1, incluidos los `interactive`.** No es la decisión obvia a primera vista (parecía razonable dejar `search_files`/`list_documents` afuera por ser los "complicados"), pero al mirar por qué son complicados en modo gateway la razón no aplica acá:
- En modo gateway, `interactive` existe para resolver un problema **de red**: el gateway tiene que esperar sobre una promesa mientras el picker SAF corre en un dispositivo remoto, sin bloquear el resto del proceso — de ahí `requestId`, eventos de progreso, ceiling de 10min, y el RPC de cancelación cruzando la conexión WS (todo lo de sección 3.3 del diseño anterior).
- En modo standalone, el tool-loop y el ejecutor del tool **son el mismo proceso** (el propio cel) — no hay red de por medio entre "quien decide llamar al tool" y "quien lo ejecuta". Llamar a `search_files` ahí es un `await platformChannel.invokeMethod(...)` local, ni más ni menos complicado que llamar a `open_app`. No hace falta `requestId`, no hace falta ceiling, no hace falta un RPC de cancelación — cancelar es simplemente invocar un método local que cierre el picker que ya está abierto en el mismo proceso.
- Lo único que hay que construir de más (que no haría falta si solo fueran los 2 `sync`) es un botón de cancelar en la UI mientras el picker está abierto — y eso ya lo tiene que construir Frontend para el modo gateway (`mobile-chat-ux-flows.md` §5), así que es la misma card, reusada, apuntando a una cancelación local en vez de un RPC.
- **Conclusión**: no hay ahorro real en dejarlos afuera de v1 — la complejidad que los hacía "los difíciles" era específicamente la orquestación en red, que no existe en standalone. Van los 4.
- ~~Consecuencia de que los 4 sean `safe`: standalone v1 no necesita approval loop en absoluto~~ — **SUPERADO, ya no es cierto (Architect, 2026-09-05).** Esto valía cuando el set completo de standalone era 4 tools `safe`. Con `phone_set_alarm`/`phone_set_timer` (`moderate`, cerrado en `external-actions-and-connectors-analysis.md` §6) y `phone_add_calendar_event` (`moderate`, §7 del mismo doc) ya sumados al set, la condición que sostenía esta conclusión dejó de cumplirse — y nadie revisó esta sección cuando pasó, así que standalone corrió tools `moderate` sin ningún gate desde que se agregó la alarma, no desde el calendario. **Corrección: standalone necesita un gate mínimo para `riskLevel != "safe"`** — no el approval card completo de gateway (esa ceremonia existía para resolver orquestación en red, que sigue sin aplicar acá), alcanza con un `AlertDialog` local antes de `executor.execute()`, con `riskLevel` leído del mismo `phoneDeviceToolSpecs` compartido que ya evita divergencia de `kind`/nombre entre gateway y standalone (extender ese archivo con el campo, no crear una segunda tabla). Esto no reabre el problema de confianza que `methods.ts` resuelve con su mapping independiente — esa defensa es contra un cliente remoto no confiable enviando `device.tools.register` por wire, y sigue aplicando igual (gateway sigue sin leer `riskLevel` del payload); en standalone no hay ningún cruce de confianza que defender, es el mismo código revisado declarando y enforceando en el mismo proceso. Sin `approvalMode` configurable para v1 standalone — con 3 tools `moderate` totales, "siempre confirma" alcanza como política fija.

### 7.2.1 Hallazgo posterior — backgrounding suspende la request al proveedor en standalone (Frontend, reproducido 2/2 en el Samsung real)

Corrección a lo que dije arriba: "mismo proceso" evita la complejidad de orquestación en red entre decisor y ejecutor, pero **no evita que un efecto de sistema operativo de ese mismo proceso (backgrounding por `startActivity`) golpee otra parte de ese mismo proceso** (la llamada HTTP al proveedor que el tool-loop mantiene abierta). No lo consideré al escribir esta sección — se me pasó.

**El problema es estructural a los 4 tools, no a 2.** `phone_open_app`/`phone_set_alarm` disparan `startActivity`; `phone_search_files`/`phone_list_documents` disparan `startActivityForResult` (el picker SAF) — los cuatro backgroundean Yggdrasil. Si el tool-loop sigue (otro tool-call, o la respuesta final) mientras la app está en segundo plano, Android suspende la red de la app backgroundeada, la request al proveedor queda colgada sin timeout ni aviso, "Pensando..." infinito hasta que el usuario vuelve a mano.

**Por qué esto no le pasa a modo gateway de la misma forma**: ahí el tool-loop entero corre server-side (la Mac nunca backgroundea) — el `SYNC_TOOL_TIMEOUT_MS`/ceiling ya absorbe un cel que no responde a tiempo, y la sesión persiste server-side (`SessionStore`) así que aunque el WS del cel se corte al backgroundear, no se pierde nada — el cel solo deja de ver el stream en vivo, lo recupera al reconectar. En standalone, la request al proveedor **es** el trabajo, corre en el propio proceso del cel — si Android la suspende/mata, no hay ningún lado server-side que la haya seguido sosteniendo.

**Recomendación: aviso de UX + retry al volver de background — no foreground service — para v1.**
- Foreground service (notificación persistente + `foregroundServiceType` + manejo de lifecycle nuevo) es una inversión real de plataforma para un edge case acotado (usuario multitaskeando a mitad de turno), y ni siquiera es garantía en este Samsung puntual — su capa propia de battery management puede seguir matando el proceso sin que el usuario además desactive la optimización de batería a mano. Coherente además con que standalone ya es, por diseño (§1.1), el modo reducido — un borde filoso más ahí es aceptable.
- Mínimo real para v1, más que "solo un copy": copy en la card (UX ya lo está armando) **+ enganchar `AppLifecycleState.resumed`** en el tool-loop standalone — si el turno sigue colgado al volver, ofrecer "Reintentar" reusando el mismo patrón que ya existe para timeout de tools `sync` en modo gateway (`mobile-chat-ux-flows.md` §3). Sin esto la única salida es forzar el cierre de la app.
- Sin flag nuevo por-tool (`backgrounds:true` o similar) — hoy los 4 tools de v1 backgroundean, así que el safety net tiene que aplicar siempre que corre cualquier device tool en standalone, no condicionado por tool. Si algún día se agrega un tool standalone que no navegue a otra Activity, el safety net no molesta, simplemente nunca se activa.
- Reconsiderar foreground service solo si esto pasa de "reproducido probando" a queja frecuente en uso real — mismo criterio que otros ítems de hardening ya pospuestos en este proyecto (ver punto 13 de `phone-gateway-connectivity-design.md`).

**Cerrado — la pregunta técnica de fondo (¿la request suspendida se recupera sola o se pierde?) tiene respuesta, mitad por código mitad empírica (Frontend, repro limpio 2026-09-05):**
- `anthropic_client.dart` (y el resto de `standalone/providers/`) usan `http.post` plano, esperando la respuesta completa — **no** streaming/SSE. Esto importa: una request de una sola vez es mucho más tolerante a que el proceso se congele un rato (el mecanismo de "freezer" de Android moderno detiene el proceso entero, no solo la red) que una conexión de stream que necesita bytes fluyendo seguido para no cortarse.
- Repro limpio de Frontend: volvió a foreground sin mandar nada ni tocar el chat, esperó pasivo — la respuesta llegó sola a los ~8s, sin reintento ni intervención.
- **Conclusión: para el caso común (background corto — abrir Spotify/reloj y volver), la request se recupera sola, no hace falta reenviar.** La propuesta de UX (`mobile-chat-ux-flows.md` §7 — copy pre-acción + estado "retomando" + timeout ~15-20s escalando a Reintentar) alcanza para v1 tal como está planteada — el timeout/retry queda como red de seguridad para el caso más duro (background más largo, Doze/proceso realmente matado en vez de congelado) que todavía no se probó, no es redundante, pero **no hace falta foreground service ni mantener la conexión viva de otra forma** — confirmado con evidencia, no asumido.

### 7.3 Chats atados al perfil — cómo se refleja en el cliente mobile

No hay `sessions.*` del lado gateway en modo `direct` — no hay gateway al que preguntarle. Esto tiene que ser un store puramente local, separado del concepto de `sessionKey` (que es protocolo gateway, no lo reutilizo acá para no confundir las dos cosas):

- **Store local nuevo** (SQLite/Hive/lo que ya use el proyecto para storage estructurado — no until yo esa elección de librería, es implementación) con registros tipo:
  ```jsonc
  { "id": "local-uuid", "profileId": "<id del ConnectionProfile>", "title": "...", 
    "messages": [...], "createdAt": 0, "updatedAt": 0 }
  ```
- **Chat list siempre refleja solo el perfil activo**, no una vista mezclada:
  - Perfil activo `type:"gateway"` → Chat list = resultado de `sessions.list` (como hoy, sin cambios).
  - Perfil activo `type:"direct"` → Chat list = chats locales filtrados por `profileId == activeProfile.id` (no mezcla chats de otros perfiles `direct` entre sí tampoco — un chat armado con la key de Claude no aparece si el perfil activo pasó a ser el de OpenAI, mismo criterio de "no migra" aplicado también entre dos perfiles `direct` distintos, no solo entre `direct` y `gateway`).
- Cambiar de perfil activo → la Chat list se re-lee desde la fuente que corresponda al nuevo perfil. Sin merge, sin intento de reconciliar ambas listas en una sola vista.
- `sessionKey` (protocolo gateway) y el `id` local de un chat `direct` son conceptos distintos que nunca se cruzan — un chat `direct` no tiene ni necesita `sessionKey`.

### 7.4 Bind de Tailscale en el gateway

**No hace falta ningún mecanismo nuevo de bind, en el sentido de red** — Tailscale se presenta ante el sistema operativo como una interfaz más, así que bindear a todas las interfaces alcanza a su IP sin código específico de Tailscale. Mi contrato original asumía tocar la constante `HOST` de `gateway.ts` directo; **Backend lo implementó distinto y mejor, actualizo acá para que el doc quede fiel al código real**:
- `HOST = "127.0.0.1"` (`gateway.ts:15`) queda **intacto** — es la dirección que usa el propio Electron para hablar con su subproceso gateway (probe, `getFreePort`, URL del renderer), no tiene nada que ver con a qué se expone el server hacia afuera, y no había que tocarla.
- `GATEWAY_BIND_HOST = "0.0.0.0"` (`gateway.ts:24`) es la constante nueva — se pasa al subproceso vía la env var `YGGDRASIL_GATEWAY_HOST` (`gateway.ts:165`), misma convención que ya existía para `YGGDRASIL_GATEWAY_PORT`.
- El bootstrap del gateway (`packages/cli/src/index.ts:72-73`) lee esa env var y la mergea en `config.gateway.host` antes de levantar el server — no pisa el `yggdrasil.config.json` del proyecto, es un override solo para ese subproceso.
- Resultado funcional idéntico a lo que pedía el contrato original (`0.0.0.0` cubre loopback + LAN + Tailscale con un solo `listen()`), pero con una separación más limpia entre "cómo Electron habla con su propio gateway" (sigue siendo loopback, sin ambigüedad) y "a qué se expone el server" (configurable por env var, sin tocar la constante que Electron usa para sí mismo).
- **Detección de la IP**: no hace falta ningún mecanismo de descubrimiento automático entre Mac y cel para v1 — el usuario pega la IP (o el hostname MagicDNS de Tailscale, ej. `mi-mac.tailXXXX.ts.net`) a mano en el campo `baseUrl` del perfil, mismo gesto que ya hace hoy con la IP de LAN. Como nicety opcional (no bloqueante, UI de desktop, no gateway): se puede mostrar la IP de Tailscale de la Mac en algún lado de la configuración para que el usuario la copie, detectándola server-side con `os.networkInterfaces()` filtrando por el rango CGNAT que usa Tailscale (`100.64.0.0/10`) — pero es comodidad, no parte del contrato mínimo.
- **Prerequisito que no cambia**: el gap de `fs.*` sin approval gate (punto 2 del diseño original) sigue siendo bloqueante para bindear a `0.0.0.0`, con o sin Tailscale de por medio — nada de esto lo saltea.

---
Generado con Claude Code — sesión: https://claude.ai/code/session_0116JqfBKympUw3Xhmr2ZVu4
