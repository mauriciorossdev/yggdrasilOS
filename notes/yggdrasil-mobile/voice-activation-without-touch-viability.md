# Investigación de viabilidad: activar el mic sin tocar la pantalla (wake word y alternativas)

Estado: **investigación de viabilidad, sin implementar y sin recomendar implementar nada todavía** — a pedido explícito del usuario. El objetivo de este doc es mostrar costos/límites reales para que el usuario decida, no empujar ninguna de las opciones. No toco código.
Basado en: lectura del código actual (`android/app/src/main/AndroidManifest.xml`, `pubspec.yaml`, `lib/chat/voice_mic_button.dart`, `lib/connectors/google_connector_screen.dart`) + `home-screen-voice-input-ux.md` (flujo de voz ya cerrado, push-to-talk vía botón).
Fecha: 2026-09-07.

**Nota de contexto**: el mensaje del usuario llegó con el arranque cortado — entiendo el pedido como "evaluar wake word real (tipo 'Hey Yggdrasil') vs. 3 alternativas sin voz continua: atajo de accesibilidad, notificación persistente con botón de mic, widget de home screen". Si el pedido real era otro, avisame y ajusto.

## 0. Punto de partida

Hoy el único disparador de voz es `VoiceMicButton` (`voice_mic_button.dart`) — push-to-talk manual: el usuario abre la app, toca el botón, `permission_handler` pide `RECORD_AUDIO` si hace falta, `speech_to_text` escucha hasta que el usuario suelta/para. Ninguna de las 4 opciones de este doc toca esa lógica de captura — **las cuatro son formas nuevas de *disparar* el mismo flujo que ya existe**, no un pipeline de audio nuevo. Vale la pena tenerlo presente: el costo real de cada opción está casi enteramente en la superficie de disparo (accesibilidad/notificación/widget/hotword), no en procesar audio.

Confirmado en el manifest actual (`AndroidManifest.xml:1-15`): declara `RECORD_AUDIO`, no declara `POST_NOTIFICATIONS` ni ningún `FOREGROUND_SERVICE*` — ninguna de las 4 opciones tiene infraestructura previa, todas parten de cero del lado nativo.

## 1. Por qué un wake word real ("Hey Yggdrasil", siempre escuchando) no es gratis

No es que sea imposible — es que la versión que la gente imagina ("el teléfono escucha en segundo plano sin gastar batería ni mostrar nada, como el Asistente de Google") **no está al alcance de una app de terceros**, por diseño de la plataforma, no por falta de esfuerzo de implementación:

- **El hotword "gratis" de Google Assistant/Bixby corre en un chip DSP de bajo consumo dedicado**, integrado por el fabricante a nivel de firmware — esa vía no es una API pública que una app instale, es hardware+SO exclusivo del asistente por default del dispositivo. Ninguna app de terceros puede engancharse ahí.
- **La alternativa de software real** (un motor de keyword-spotting corriendo en la CPU, ej. Picovoice Porcupine u otro SDK similar — sí existe y sí es viable técnicamente, más abajo) tiene que correr de forma continua para poder "escuchar" en todo momento, y Android exige que cualquier proceso que sostenga el micrófono en segundo plano sea un **foreground service** — desde Android 14 (API 34) específicamente tipado `foregroundServiceType="microphone"`, con el permiso `FOREGROUND_SERVICE_MICROPHONE` declarado aparte. Un foreground service **no puede ser invisible por diseño**: el sistema fuerza una notificación persistente mientras corre (no es una limitación nuestra, es la política de la plataforma para que el usuario siempre sepa que algo sigue vivo en segundo plano).
- **El indicador de mic-en-uso** (el puntito/ícono verde en la barra de estado, Android 12+) se prende cada vez que cualquier app toca el micrófono — un listener "siempre activo" significa ese indicador prendido de forma prácticamente constante, una señal visible y persistente de que el mic está en uso todo el tiempo. Para un wake word de verdad no hay forma de evitar esto tampoco.
- **Batería**: aun con un motor optimizado para esto (Porcupine y similares están pensados justamente para minimizar el costo comparado con correr reconocimiento de voz completo todo el tiempo), sigue siendo CPU despierta de forma continua — categóricamente más consumo que el DSP dedicado del asistente nativo, sin un número exacto posible sin medirlo en el dispositivo real.
- **Doze/optimización de batería de Android** (y la capa propia de gestión de batería de Samsung/One UI, la misma que ya complicó `phone_set_alarm` en este proyecto) tiende a matar procesos de fondo agresivamente salvo que el usuario desactive esa optimización a mano para esta app — un paso de fricción/soporte más, no algo que se resuelva solo con código.

**Conclusión de esta sección**: un wake word real es técnicamente posible (§4 lo detalla como opción, no descartada del todo), pero **nunca va a ser "gratis" ni invisible** — viene con notificación persistente obligatoria, indicador de mic siempre visible, y consumo de batería mayor que las 3 alternativas de abajo. El trade-off que menciona el pedido es real y no tiene vuelta atrás por decisiones de plataforma, no por límite de este proyecto puntual.

## 2. Las 3 alternativas — qué dan y qué cuestan

Las tres comparten un requisito de plomería nuevo: **un punto de entrada en la app que reciba "abrí y arrancá a escuchar" sin pasar por la UI normal** — hoy `app_links`/`AppLinks` (`google_connector_screen.dart:45-87`) solo está escuchado localmente dentro de esa pantalla puntual, para el callback de OAuth de Google — no hay un router de deep-links global. Cualquiera de las 3 opciones necesita sumar ese listener a nivel de `main.dart` (uno solo, reusable por las 3), con un esquema nuevo tipo `yggdrasil://voice/listen` que dispare directo el flujo de `VoiceMicButton` sin que el usuario tenga que navegar manualmente.

### 2.1 Atajo de accesibilidad (`AccessibilityService`)

- **Qué es en realidad**: Android permite registrar un servicio de accesibilidad que puede reaccionar a un disparador del sistema. Hay dos mecanismos distintos y **no son lo mismo** — importa la diferencia:
  - El atajo clásico (mantener volumen o combinación de teclas) **prende/apaga** el servicio de accesibilidad — es un toggle, no un "ejecutar de nuevo" repetible. Si el servicio ya está activo, invocar el atajo otra vez lo apaga. No sirve tal cual para "un gesto = abrir y escuchar" cada vez.
  - El **botón de accesibilidad** (`AccessibilityButtonController`/`onAccessibilityButtonClicked`, un botón flotante en la barra de navegación desde Android 8) sí da un callback repetible por cada toque, sin togglear nada — es el mecanismo correcto para esto.
  - **A confirmar en el Samsung real, no asumido**: si el dispositivo usa gestos de navegación (sin barra de 3 botones) el botón de accesibilidad flotante puede comportarse distinto, y One UI tiene su propio menú de atajos de accesibilidad que puede no coincidir 1:1 con el stock de Android — hay que probarlo en el hardware real antes de cerrar esto, mismo criterio de verificación que ya se aplicó a `ACTION_SET_ALARM` en este proyecto.
- **Qué da**: funciona desde **cualquier pantalla, con el teléfono desbloqueado o no** (dependiendo de configuración) — es lo más parecido a "sin mirar el teléfono" de las 3 alternativas, un solo gesto físico sin necesitar pull-down de notificaciones ni encontrar un widget.
- **Costo real**: 
  - Implementación: una clase `AccessibilityService` nueva + declaración en manifest + XML de config — no trivial pero acotado, sin trabajo de audio nuevo (dispara el mismo flujo de `VoiceMicButton`).
  - **Fricción de confianza real, aunque sea para uno mismo**: Android muestra un diálogo de permiso de accesibilidad con lenguaje genérico y alarmante ("esta app puede ver el contenido de la pantalla y las acciones que realizás") que no distingue "lo uso apenas para un botón" de un uso invasivo real — el usuario tiene que activarlo a mano en Ajustes → Accesibilidad → Apps descargadas, un paso de setup manual explícito, y aceptar ese texto de advertencia sabiendo que en este caso es inocuo.
  - Batería: despreciable — es un servicio dirigido por evento, no escucha nada de forma continua.

### 2.2 Notificación persistente con botón de mic — **ya implementada**

Diseño cerrado e implementación en curso con Frontend: ver `notes/yggdrasil-mobile/voice-notification-shortcut-design.md`. El resto de esta sección queda como quedó (contexto de la decisión original), no la reabro acá.

- **Qué es**: una notificación (`NotificationCompat`, con `addAction` para el botón de mic) visible en la bandeja/lockscreen, tocar el botón dispara el mismo flujo de escucha.
- **Qué da**: acceso en un toque desde la bandeja de notificaciones — más rápido que abrir la app entera, pero **sigue necesitando desbloquear el teléfono y bajar la bandeja** (o que la notificación se vea directo en la pantalla de bloqueo, configuración que no es igual en todos los Android/OEM — a confirmar en el Samsung real si un botón de acción de notificación es accionable sin desbloqueo completo, no asumido acá).
- **Costo real**:
  - Implementación: la más simple de las 3 — API de notificaciones estándar, sin superficie nativa nueva más allá de eso.
  - `POST_NOTIFICATIONS` (Android 13+) es un permiso runtime nuevo que hay que pedir — no declarado hoy (§0).
  - Persistencia real (que la notificación no desaparezca si Android mata el proceso en background) probablemente pide atarla a un foreground service liviano — **ese servicio no necesita tocar el micrófono en absoluto** (solo mantener viva la notificación), así que no dispara el requisito de `foregroundServiceType="microphone"`/notificación-obligatoria-por-mic de §1 — es un servicio de un tipo mucho más liviano (ej. `dataSync`/`specialUse`), sin el costo de batería de un listener de audio.
  - Alternativa más simple todavía, a probar primero: notificación simple sin foreground service — más barata, con el riesgo de que Android la descarte si mata el proceso en background por mucho tiempo; empezar así y subir a foreground service solo si en el uso real se pierde la notificación con frecuencia.
- Batería: despreciable, dirigido por evento igual que §2.1.

### 2.3 Widget de home screen

- **Qué es**: un widget nativo (`AppWidgetProvider` + `RemoteViews`) con un botón de mic, tocarlo desde la pantalla de inicio dispara el flujo de escucha.
- **Qué da**: menos que las otras dos en la práctica — **sigue necesitando desbloquear el teléfono y estar en la página de inicio específica donde está el widget**. Comparado con el estado actual (abrir la app + tocar el botón), un widget ahorra literalmente un toque (no hace falta esperar a que cargue la app entera) — la mejora real es la más chica de las 3.
- **Widgets en pantalla de bloqueo**: existieron en Android viejo (4.x) y fueron discontinuados como feature general de plataforma — algunos fabricantes (Samsung con Always On Display, por ejemplo) mantienen su propio mecanismo, pero no es una API estándar de Flutter/Android moderna en la que apoyarse — no lo cuento como parte real de esta opción sin confirmarlo en el dispositivo específico.
- **Costo real**: 
  - Flutter no puede renderizar el widget directo (los widgets de home screen corren en un proceso separado con `RemoteViews`, un sistema de vistas limitado, no el motor de Flutter) — hace falta código nativo Kotlin (el `AppWidgetProvider`, layout XML) más un puente del lado Flutter, típicamente vía un paquete como `home_widget` (no está en `pubspec.yaml` hoy, sumaría una dependencia nueva).
  - Es la opción con más piezas nuevas (nativo + paquete + puente), para el beneficio más chico de las 3 — peor relación esfuerzo/beneficio del grupo.
  - Batería: despreciable, mismo criterio.

### 2.4 Overlay flotante tipo burbuja

- **Qué es**: una vista flotante ("burbuja", igual al patrón de chat heads de Messenger) dibujada sobre cualquier app vía `WindowManager.addView` con `TYPE_APPLICATION_OVERLAY`, arrastrable/reposicionable, visible en todo momento sin importar qué app esté abierta. Tocarla dispara el mismo flujo de escucha que las otras 3 opciones (§2, la plomería del deep link "abrí y escuchá" es compartida por las cuatro).
- **Permiso**: `SYSTEM_ALERT_WINDOW` — un permiso especial, no un runtime dialog estándar de los que pide `permission_handler`. Se otorga vía `Settings.ACTION_MANAGE_OVERLAY_PERMISSION`, el usuario tiene que ir a Ajustes a mano y activar "Mostrar sobre otras apps" para esta app específica — misma fricción de setup manual explícito que ya tiene el atajo de accesibilidad (§2.1), aunque el texto de este diálogo es menos alarmante que el de accesibilidad.
- **Costo de implementación — necesita `Service` corriendo, a diferencia de la notificación**: acá sí hace falta un `Service` (no necesariamente foreground, pero sí un componente que viva mientras la burbuja está en pantalla) sosteniendo la referencia al `WindowManager` y a la vista agregada — si el proceso muere, la burbuja desaparece de la pantalla. Esto es la diferencia real frente a §2.2: la notificación (`voice-notification-shortcut-design.md` §2.2, ya corregido en esa ronda) se posta sin ningún `Service` porque `NotificationManagerCompat` la sostiene el propio sistema operativo, no el proceso de la app — un overlay no tiene ese lujo, es una `View` que vive en la ventana de la propia app y necesita el proceso vivo para seguir dibujada.
- **Batería**: mayor que la notificación pasiva, aunque bastante menor que un listener de audio continuo (§1) — no hay procesamiento de voz corriendo, pero sí una `View` dibujada de forma constante sobre el resto de la UI del sistema, con el costo de composición/render que eso implica de forma continua mientras el overlay está visible. Sin medirlo en el dispositivo real no hay un número — mismo criterio que el resto del doc, no asumir un valor sin confirmarlo.
- **Fricción/OEM — a confirmar en el Samsung real, no asumido**: la gestión agresiva de batería de varios fabricantes (Samsung/One UI incluido, y de forma más marcada en varios OEM chinos) es conocida por matar procesos en background con más agresividad que AOSP puro — un `Service` sosteniendo un overlay es exactamente el tipo de proceso "aparentemente en segundo plano" que esas optimizaciones apuntan a matar para ahorrar batería, aun cuando el usuario lo perciba como "algo que sigue visible en pantalla". El mismo patrón de sorpresa ya visto en este proyecto con `ACTION_SET_ALARM` (permiso `com.android.alarm.permission.SET_ALARM` no documentado por AOSP, solo descubierto al probar en el Samsung real) y con `MANAGE_EXTERNAL_STORAGE` aplica acá: no hay forma de saber si el overlay sobrevive en el uso real de este Samsung sin probarlo en el hardware — queda marcado como pendiente de verificación, no como dato asumido.

## 3. Comparación — esfuerzo vs. beneficio

| Opción | Esfuerzo de implementación | Qué gana sobre "abrir la app y tocar el botón" | Batería |
|---|---|---|---|
| Wake word real (Porcupine u otro motor, §4) | Alto — SDK nuevo, foreground service tipado, notificación obligatoria, posible costo de licencia | El máximo posible: cero contacto físico, solo la voz | Real, la más alta de las 5 (aunque optimizado, sigue siendo CPU despierta de forma continua) |
| **Notificación persistente — ya implementada** | **Bajo** — sin `Service`, la posta el sistema (§2.2, `voice-notification-shortcut-design.md`) | Un toque desde la bandeja, sin abrir la app | Despreciable — nada dibujándose ni corriendo de forma continua |
| **Atajo de accesibilidad** | Medio | Un gesto físico desde cualquier pantalla, sin bajar bandeja ni buscar nada | Despreciable — dirigido por evento |
| Overlay flotante tipo burbuja (§2.4) | Medio — necesita `Service` + `WindowManager` + permiso especial `SYSTEM_ALERT_WINDOW` (fricción de setup manual, como accesibilidad) | Visible y accionable desde cualquier pantalla sin bajar bandeja, como el atajo de accesibilidad — pero ocupa espacio de pantalla de forma permanente, a diferencia de éste | Media — `View` dibujada de forma continua, más que notificación/accesibilidad pero muy por debajo de un listener de audio |
| Widget de home screen | Medio-alto (más piezas nuevas) | Un toque menos que abrir la app — mejora marginal | Despreciable |

**Mi lectura, no una decisión — el usuario define qué sigue**: la notificación persistente (§2.2) ya está implementada y fue la de mejor relación esfuerzo/beneficio, como se esperaba. Entre las que quedan pendientes, el atajo de accesibilidad (§2.1) sigue siendo mejor opción que el overlay (§2.4) para "sin tocar la pantalla": el overlay da lo mismo (accesible desde cualquier app, sin bajar bandeja) pero con más esfuerzo de implementación (`Service` + `WindowManager`, no solo un callback de evento), el mismo tipo de fricción de permiso especial que accesibilidad, batería estrictamente peor (dibuja algo de forma continua; accesibilidad no dibuja nada), y el riesgo adicional — no compartido con accesibilidad — de que la gestión de batería del OEM mate el `Service` que lo sostiene (§2.4, a confirmar en el Samsung real). La única ventaja real del overlay sobre accesibilidad es la visibilidad: un botón siempre a la vista en pantalla es más descubrible que un gesto que hay que recordar — si esa visibilidad permanente importa más que el costo extra, ahí es donde el overlay gana; si no, accesibilidad lo domina en casi todo lo demás. El widget (§2.3) sigue siendo el que menos aporta del grupo. Como las cuatro alternativas sin wake word comparten la misma plomería base (§2, "abrir y escuchar" vía deep link), no son mutuamente excluyentes.

## 4. Si más adelante se quisiera wake word real de verdad

No lo descarto como imposible — solo como no-gratis (§1). El camino técnico real, si algún día se decide pagar ese costo:

- **Motor de keyword-spotting on-device** tipo Picovoice Porcupine (u otro SDK equivalente) — corre local, sin mandar audio a ningún servidor, entrenado para una palabra de activación custom. Tiene plugin Flutter (a confirmar versión/licencia vigente al momento de evaluar esto en serio, mismo criterio de no asumir que un paquete externo sigue como se lo recuerda sin chequear pub.dev/el sitio del proveedor primero).
- Estructura necesaria: foreground service tipado `microphone` (Android 14+, permiso `FOREGROUND_SERVICE_MICROPHONE` + `RECORD_AUDIO` ya declarado) + notificación persistente obligatoria (no opcional, es requisito de plataforma) + manejo de que Doze/batería de Samsung no mate el proceso (puede requerir pedirle al usuario que desactive la optimización de batería para esta app a mano, otro paso de fricción).
- Esto queda anotado como **v2 hipotético**, no parte de la recomendación de esta ronda — solo para que el usuario tenga el panorama completo al decidir, tal como pidió.

## 5. Resumen

1. **Wake word real**: técnicamente posible, no gratis — notificación persistente obligatoria, indicador de mic siempre visible, batería real. No es una limitación de este proyecto, es política de plataforma.
2. **Notificación persistente con botón de mic — ya implementada**: mejor relación esfuerzo/beneficio del grupo, confirmado — sin `Service`, la sostiene el propio sistema, acceso en un toque desde la bandeja. Ver `voice-notification-shortcut-design.md`.
3. **Atajo de accesibilidad**: sigue siendo, de las que quedan pendientes, la que más se acerca a "sin tocar la pantalla" — funciona desde cualquier pantalla sin bajar bandeja, a cambio de más esfuerzo de implementación y de la fricción de aceptar el permiso de accesibilidad (genérico/alarmante en su texto, aunque el uso real acá sea inocuo).
4. **Overlay flotante tipo burbuja** (§2.4): misma alcance que el atajo de accesibilidad (visible desde cualquier app, sin bajar bandeja) pero peor en casi todo lo demás — necesita `Service` + `WindowManager` + permiso especial `SYSTEM_ALERT_WINDOW`, batería estrictamente mayor (dibuja algo de forma continua), y riesgo adicional de que la gestión de batería del OEM mate el `Service` que lo sostiene (a confirmar en el Samsung real, mismo criterio que `ACTION_SET_ALARM`/`MANAGE_EXTERNAL_STORAGE`). Solo gana si la visibilidad permanente en pantalla pesa más que ese costo extra.
5. **Widget de home screen**: la opción más cara en piezas nuevas (nativo + paquete + puente) para la mejora más chica (un toque menos que abrir la app) — la peor relación esfuerzo/beneficio del grupo.
6. Las 4 alternativas sin wake word comparten la misma plomería base (deep link "abrir y escuchar" hacia el flujo ya existente de `VoiceMicButton`) y no son mutuamente excluyentes — se pueden combinar sin duplicar trabajo.
7. Nada de lo que sigue pendiente (accesibilidad, overlay, widget, wake word) se implementa sin que el usuario decida — este doc es panorama de costos, no una propuesta lista para ejecutar.

---
Generado con Claude Code — sesión: https://claude.ai/code/session_01WYAisFZiCxEX1YPyCKM7P7
