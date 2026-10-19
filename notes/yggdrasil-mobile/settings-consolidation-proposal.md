# Propuesta: consolidar "URL del gateway" con "Perfiles de conexión"

Estado: **implementada y probada en vivo (Samsung físico), 2026-09-05.**

## 0. El hallazgo (verificado en código, no es una suposición)

Al armar el mockup de Configuración en Claude Design me di cuenta de que "URL del gateway" y "Perfiles de conexión" (gateway/provider) **hoy son dos sistemas paralelos, no uno solo** — y esto ya está señalado como incompleto en el propio código, no es una lectura mía:

- `profile_store.dart:15-17`: comentario explícito — *"Legacy single baseUrl key from before profiles existed... read only for one-time migration."*
- `profiles_screen.dart:7-11`: comentario explícito — *"This screen only manages the list + which profile is marked active; actually switching the live connection over to a selected profile is separate follow-up work."*
- `main.dart` conecta el WS real (`_client`) usando `_baseUrl`, un string suelto que persiste con su propia key (`_updateConfig`/`onChangeBaseUrl`) — **totalmente aparte** del sistema de `ConnectionProfile`.
- `chat_list_screen.dart` lee `ProfileStore.getActive()` para decidir modo gateway/directo (`_isDirectMode`) y mostrar nombre/subtítulo, pero **nada conecta ese perfil activo con el `_client` real de `main.dart`** — activar un perfil "gateway" en la lista hoy no reconecta el socket a esa URL.

Conclusión: no es una pregunta de "¿los pongo juntos o separados en la UI?" — hoy están separados **de hecho, a nivel de datos**, y eso ya es la fuente real de confusión (y un bug latente: cambiar "URL del gateway" no actualiza el perfil activo, y viceversa).

También hay una segunda confusión, distinta, que el usuario probablemente estaba señalando: **"Configuración de agente" (`config_page.dart`) y el campo "Provider" de un perfil "Provider directo" usan casi el mismo vocabulario para cosas distintas**:
- "Configuración de agente" = qué LLM corre **del lado del gateway** (RPC `config.get`/`config.patch` contra el gateway conectado).
- El "Provider" de un perfil directo = qué LLM llama **el teléfono directamente**, sin gateway de por medio (modo standalone).
Son conceptualmente independientes — uno no tiene sentido sin gateway conectado, el otro es exactamente lo contrario (existe *porque* no hay gateway).

## 1. Propuesta

**Los perfiles pasan a ser la única fuente de verdad para "a dónde me conecto".** Se elimina el concepto de "URL del gateway" como setting global aparte — editar la URL de conexión es editar el perfil activo (o crear uno, si no hay ninguno). Esto no es una idea nueva: es terminar el trabajo que `profiles_screen.dart` ya marca como pendiente ("switching the live connection... is separate follow-up work") — la propuesta de UX simplemente asume que ese trabajo se hace, y diseña la pantalla de Configuración como si ya estuviera unificado.

**"Configuración de agente" se muestra condicionalmente**, no siempre: solo tiene sentido cuando el perfil activo es tipo `gateway` (hay un gateway conectado al que pedirle su config). Si el perfil activo es `direct`, esa entrada **no aparece** — no porque sea una decisión de gusto, sino porque `config.get`/`config.patch` son RPCs del gateway; en modo standalone no hay gateway al que llamarlas, probablemente fallarían o no tendrían efecto. El "provider"/"modelo" en modo directo ya se edita en el editor del perfil mismo — no hace falta una segunda pantalla para lo mismo.

### 1.1 Menú de Configuración — reconciliado

**Nota de naming**: con esta propuesta hay tres cosas que se podrían llamar "perfil" (perfil de conexión, el perfil de conexión activo, y ahora "tu perfil"/identidad de usuario del hallazgo de Frontend en §3.1) — eso es exactamente el tipo de confusión que esto busca resolver, así que el label de la fila de conexión activa pasa a **"Conexión activa"** (no "Perfil activo"), dejando la palabra "perfil" reservada solo para `ConnectionProfile` (donde ya vive en el código, `ProfilesScreen`/`ProfileEditorScreen`) y agregando **"Personalización"** para lo que es del usuario, no de la conexión.

```
Modo GATEWAY activo (o sin perfiles todavía):          Modo DIRECTO activo:
┌───────────────────────────────┐                      ┌───────────────────────────────┐
│ ← Configuración                │                      │ ← Configuración                │
├───────────────────────────────┤                      ├───────────────────────────────┤
│ Personalización                 │                      │ Personalización                 │
│ Alex                           │  ← NUEVO, ver §1.1a   │ Alex                           │
├───────────────────────────────┤                      ├───────────────────────────────┤
│ Conexión activa                │                      │ Conexión activa                │
│ Mi PC de casa                  │  ← tap = abre el      │ Anthropic directo              │  ← tap = abre el
│ ws://100.64.1.4:18889          │    editor de ESE      │ Anthropic (Claude) · sonnet-5  │    editor de ESE
│                                 │    perfil (ahí se     │                                 │    perfil (ahí se
│                                 │    edita la URL,      │                                 │    edita provider/
│                                 │    ya no hay un       │                                 │    modelo/API key,
│                                 │    campo aparte)      │                                 │    ya está todo acá)
├───────────────────────────────┤                      ├───────────────────────────────┤
│ Configuración de agente         │  ← SOLO en modo      │ (no aparece — no hay gateway    │
│ Anthropic (Claude) · sonnet-5   │    gateway: el LLM    │  al que pedirle su config;      │
│                                 │    que corre en ESE   │  el "provider" ya es un campo   │
│                                 │    gateway            │  del perfil de arriba)          │
├───────────────────────────────┤                      ├───────────────────────────────┤
│ Perfiles de conexión            │                      │ Perfiles de conexión            │
│ 2 guardados · Mi PC de casa     │                      │ 2 guardados · Anthropic activo  │
│   activo                       │                      │                                 │
└───────────────────────────────┘                      └───────────────────────────────┘
```

- **"Conexión activa"** reemplaza a "URL del gateway" como fila de conexión — muestra nombre + el dato relevante según tipo (URL si es gateway, provider·modelo si es directo), y tocarlo abre directo el editor de ESE perfil (mismo `ProfileEditorScreen` que ya existe, sin pantalla nueva). Editar ahí y guardar es lo que antes hacía el diálogo de "URL del gateway" — mismo resultado, un solo lugar.
- **Sin perfiles todavía** (primera vez que se abre la app, antes de crear ninguno): esta fila se reemplaza por un call-to-action "Conectar a un gateway" que abre el editor en blanco, tipo `gateway` preseleccionado — cubre el caso que hoy resuelve el diálogo simple de "URL del gateway" para alguien que recién empieza, sin necesitar mantener ese diálogo como código aparte.
- **"Configuración de agente"** solo se renderiza si `activeProfile.type == gateway`. En modo directo desaparece del menú entero (no un estado deshabilitado/grisado — directamente no está, porque no aplica).
- **"Perfiles de conexión"** no cambia de lugar ni de función — sigue siendo la lista completa para gestionar/crear/cambiar entre todos los perfiles guardados.

### 1.1a "Personalización" — nueva sección (dato adicional del usuario, 2026-09-05)

El usuario pidió explícitamente dejar lugar en la estructura para, a futuro, configurar ahí también la "personalidad" de Yggdrasil (probablemente system prompt/tono/comportamiento — a confirmar qué tan literal es eso cuando lo revise). **No se implementa ahora** — solo se reserva el espacio para que meterlo después no obligue a rediseñar la pantalla.

```
┌───────────────────────────────┐
│ ← Personalización              │
├───────────────────────────────┤
│ Tu nombre                      │
│ ╭─────────────────────────╮    │
│ │ Alex                    │    │  ← el campo real que agrega Frontend
│ ╰─────────────────────────╯    │     (§3.1) — a quién saluda el home
│ [ Guardar ]                    │
├───────────────────────────────┤
│ Personalidad de Yggdrasil       │
│ ┌─────────────────────────┐    │
│ │ 🔒 Próximamente          │    │  ← card atenuada, no interactiva
│ │ Vas a poder ajustar el   │    │     — reserva el lugar, sin
│ │ tono y comportamiento    │    │     funcionalidad todavía
│ │ del agente acá.          │    │
│ └─────────────────────────┘    │
└───────────────────────────────┘
```

- Se accede desde "Personalización" en el menú de Configuración (primera fila, arriba de "Conexión activa" — es lo primero que ve alguien nuevo, antes de meterse en nada técnico).
- "Tu nombre" es el campo real de §3.1 (Frontend ya lo está agregando) — esta pantalla es simplemente dónde vive en la navegación, no agrega alcance nuevo a lo que Frontend ya tiene luz verde de hacer.
- "Personalidad de Yggdrasil" es un bloque visualmente presente pero **deshabilitado/atenuado**, con un texto corto explicando qué va a hacer — no un campo vacío ni un botón que no hace nada al tocarlo (eso confunde), sino una card con ícono de candado/reloj que deja claro que es un adelanto, no una función rota.
- Cuando se defina el alcance real (system prompt libre vs. presets de tono vs. otra cosa), esta card se reemplaza por el control real — no hace falta tocar el resto de la pantalla ni el menú de Configuración.

### 1.2 Por qué no separarlos del todo (la otra opción que se podía tomar)

La alternativa sería mantener "URL del gateway" como un campo totalmente independiente de los perfiles (dos sistemas conviviendo a propósito). La descarto porque:
- Ya generan el bug latente descrito en §0 — no es una superficie nueva de riesgo, es cerrar una que ya existe.
- Un usuario que edita "URL del gateway" esperando que afecte su conexión actual, y en realidad tiene un perfil "gateway" activo con OTRA url guardada, ve un comportamiento inconsistente sin ninguna pista de por qué.
- El propio código ya apunta a esto como pendiente, no como diseño intencional — no estoy proponiendo desarmar algo que alguien decidió mantener separado a propósito.

## 2. Qué NO cambia

- `ProfileEditorScreen` (nombre, toggle Gateway/Directo, campos condicionales) — sigue siendo exactamente como está, solo se llega a él desde un lugar más (el settings menu, tocando "Perfil activo") además de desde "Perfiles de conexión".
- `ConfigPage` (provider/modelo del agente) — mismo contenido, solo se oculta su entrada de menú cuando no aplica.
- Nada de esto toca protocolo ni RPCs nuevos — es reorganización de navegación + una condición (`activeProfile?.type == gateway`) que ya existe como dato (`_isDirectMode` en `chat_list_screen.dart`).

## 3. Mockup

Actualizado en el artifact de Claude Design (mismo link de antes) — el menú de Configuración ahora refleja esta propuesta: "Personalización" arriba (nombre + card "Próximamente" de personalidad, §1.1a), "Conexión activa" debajo, "Configuración de agente" condicional, con los dos perfiles de ejemplo (uno gateway activo, uno directo) para poder tocar y ver ambos casos.

## 3.1 Hallazgo relacionado de Frontend (mismo patrón, resuelto por separado)

Al portar el re-skin a Flutter, Frontend encontró el mismo patrón de conflación en otro lugar: la app no tiene concepto de "identidad de usuario" — el saludo del home ("Buenos días, {nombre}") y el avatar usaban `ConnectionProfile.name` (nombre técnico del perfil, ej. "Mi PC de casa") como si fuera el nombre de la persona. Se rompía con perfiles nombrados técnicamente (ej. un perfil llamado "claude" hacía que la app se saludara "Seguís despierto, claude" a sí misma).

Confirmado con Frontend: se separan. Perfil de conexión = cómo llegar a un backend (técnico, puede haber varios). Identidad de usuario = a quién saludar (una sola, independiente del perfil activo) — campo nuevo (`userName`) en preferencias, sin tocar `ConnectionProfile`. El mockup de Claude Design ya los tenía separados desde el principio (el tweak `userName` nunca tomó el nombre de un perfil) — mismo criterio que esta propuesta de §1, no es una decisión nueva, es la misma regla aplicada dos veces.

## 4. Factibilidad — confirmada por Frontend (2026-09-05)

**1. Conectar `_client` a `ProfileStore.getActive()`: sí, factible esta ronda.** Confirmado en código: hoy `_setActive()` (`profiles_screen.dart`) solo escribe `ProfileStore` + `SnackBar`, y `_save()` (`profile_editor_screen.dart`) solo hace `upsert`+pop — ninguno de los dos toca `main.dart`, es CERO wiring real, no un wiring parcial. Plan concreto de Frontend:
- `main.dart` lee `ProfileStore.getActive()` en vez de `loadSavedBaseUrl()`. Gateway → arma `_client` con `profile.baseUrl`/`apiKey`. Directo o sin perfil → **ni intenta conectar WS** (hoy conecta siempre sin importar el perfil, aunque en modo directo nadie use ese `_client` — `DirectChatScreen`/`StandaloneChatEngine` no lo tocan; esto de paso cierra un desperdicio de conexión que existe hoy).
- Reusa el patrón que ya existe en `_updateConfig` (disconnect+recrear+reconnect), parametrizado por perfil en vez de por url suelta.
- Falta un callback perfil-cambió → `main.dart` (no existe hoy; se agrega en el mismo lugar donde hoy se pasa `onChangeBaseUrl`).
- Sacar el diálogo "URL del gateway" **simplifica**, no complica — desaparece un path paralelo, no se agrega uno.
Acotado a `main.dart` + `chat_list_screen.dart`, sin tocar protocolo/RPCs.

**2. `config.get`/`config.patch` sin gateway: NO fallan limpio — cuelgan indefinidamente. Hallazgo nuevo de Frontend, no era solo una pregunta hipotética.** Confirmado en `yggdrasil_client.dart`: `call()` hace `_channel?.sink.add(...)` (no-op silencioso si `_channel` es `null`) y devuelve un `Completer` que **nunca resuelve** si el canal está muerto/null — sin timeout, sin rechazo. `config_page.dart::_loadData()` await-ea eso directo → en modo directo (o cualquier momento sin gateway real conectado) queda con spinner infinito, sin error visible. Esto ya es un gap pre-existente marcado de otra ronda, independiente de esta propuesta. **Conclusión: no ofrecer la entrada "Configuración de agente" en modo directo no es preferencia de diseño — es necesario dado cómo está hecho `call()` hoy**, sin eso el usuario queda con un spinner roto sin salida.

**3. Razón técnica para mantener "URL del gateway" separado: ninguna encontrada.** Es legacy puro pre-perfiles (`_baseUrlKey`), solo lo usan `main.dart`/`_updateConfig`/`_openConfigUrlDialog`, y `ProfileStore` ya tiene la migración one-time para absorberlo. Plegarlo es limpio.

**Usuario dio luz verde (2026-09-05) — implementado y probado en vivo por Frontend el mismo día.**

## 5. Cómo quedó implementado (2026-09-05)

- `main.dart`: sin `_baseUrl` legacy. Nuevo `_applyProfile` lee `ProfileStore.getActive()`; guard `_sameConnection` evita reconectar si el perfil activo no cambió (evita reconexiones espurias en cada `_load()`). Perfil `direct` → no abre WS. Sin perfiles → cae al mismo default `localhost` de siempre, tratado como candidato a gateway.
- `onProfileChanged`: callback nuevo que `SettingsScreen` dispara al editar/activar/crear un perfil — `main.dart` resincroniza desde ahí, en vez de que `main.dart` tenga que enterarse por su cuenta.
- `lib/chat/settings_screen.dart` (nuevo, reemplaza el bottom-sheet viejo): Personalización → Conexión activa (o CTA "Conectar a un gateway" sin perfiles) → Configuración de agente (condicional, `!isDirectMode`) → Perfiles de conexión — mismo orden y condición de la propuesta.
- `chat_list_screen.dart`: `_openConfigUrlDialog`/`onChangeBaseUrl`/`widget.baseUrl` eliminados enteros.
- **Bug adicional encontrado y corregido en el camino** (no estaba en el alcance original, pero es el mismo tipo de problema — estado que no se releía): el saludo/avatar del home y el drawer solo leían `UserNameStore` una vez en `initState`, así que guardar el nombre en Personalización no se reflejaba hasta reiniciar la app. Atado a `_load()` (que ya corre al volver de Settings) en vez de un fetch aparte.
- Probado en vivo con perfil real `direct` (Anthropic, llamado "claude"): "Configuración de agente" no aparece (condicional confirmado), "Conexión activa" abre el editor de ese perfil con sus datos reales, nombre guardado persiste tras reiniciar y se refleja en saludo+avatar.
- `yggdrasil_client.dart` no se tocó — no hacía falta. `flutter analyze`/tests limpios.
