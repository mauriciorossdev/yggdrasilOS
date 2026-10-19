# Diseño: notificación persistente + atajo de voz sin tocar la app

Estado: **propuesta de diseño, sin implementar**. No le mando nada a Frontend todavía — coordina el usuario. Basado en `voice-activation-without-touch-viability.md` (investigación previa, §2.2 y §3 de ese doc) y en lectura del código actual citado abajo con archivo:línea.

**Nota de contexto**: el mensaje del usuario llegó con el arranque cortado de nuevo ("la notificación tiene que ser tocable/acci[onable]... investigaste en el doc de viabilidad, notificación obligatoria más prominente"). Entiendo la decisión ya tomada como:

1. Se implementa §2.2 del doc de viabilidad (notificación persistente con botón de mic), no el atajo de accesibilidad ni el widget.
2. La notificación tiene que ser **tocable/accionable** — tanto el cuerpo de la notificación como su botón de acción disparan el mismo flujo de escucha (no es solo informativa).
3. Tiene que ser **más prominente** que una notificación descartable normal — esto es sobre el copy/importancia del canal (§2.3), no sobre necesitar un `Service` corriendo. La decisión real (corregida tras una primera lectura mía al revés) es **arrancar por la opción barata** que el doc de viabilidad proponía probar primero (línea 51: "notificación simple sin foreground service... empezar así y subir a foreground service solo si se pierde con frecuencia") — nada de `Service` ni foreground service en esta ronda, ver §2.

Si alguno de estos 3 puntos no es lo que pediste, avisame y ajusto — no reabro la elección entre las 4 alternativas del doc de viabilidad (eso ya está cerrado), solo estas 3 precisiones sobre cómo se implementa la elegida.

## 0. Punto de partida (qué existe hoy, qué no)

- El flujo de voz vive en `VoiceMicButton` (`lib/chat/voice_mic_button.dart`), montado dentro de `ComposerBar` (`lib/chat/composer_bar.dart:118-122`) — un widget de estado privado (`_VoiceMicButtonState`, línea 42) que reacciona a un tap sobre sí mismo. No hay ningún punto de entrada externo a ese flujo hoy: nada fuera del propio widget puede "apretar" el botón por él.
- Deep links: `app_links` ya es dependencia (`pubspec.yaml:44`) y ya se usa, pero **solo localmente** dentro de `GoogleConnectorScreen` (`lib/connectors/google_connector_screen.dart:45-91`) para el callback de OAuth — un `AppLinks()` + `uriLinkStream.listen` que vive y muere con esa pantalla. `main.dart` (`lib/main.dart`) no tiene ningún listener de deep link a nivel de app — confirmado leyendo el archivo completo, sin `import 'package:app_links/app_links.dart'` en él.
- El manifest (`android/app/src/main/AndroidManifest.xml`) hoy declara un solo intent-filter de `VIEW` custom-scheme, el de OAuth (líneas 65-70: `yggdrasil://oauth/google/callback`). No hay `POST_NOTIFICATIONS`, ni `FOREGROUND_SERVICE*`, ni ningún otro filtro `yggdrasil://` — confirma lo que ya decía el doc de viabilidad §0 (línea 13).
- El puente nativo existente (`com.yggdrasil.app/device_tools`, `lib/services/device_tools_channel.dart:8` / `MainActivity.kt:27`) es específicamente para los `phone_*` tools que el modelo invoca vía gateway — no es donde debería vivir esto: la notificación de voz es infraestructura de la app, no una tool del LLM. Uso esto como referencia de *patrón* (MethodChannel nativo en vez de paquete Flutter de terceros), no como el canal a extender.

## 1. Plomería compartida: deep link global

Necesitamos un router de deep links a nivel de app, no local a una pantalla — el mismo gap que señalaba el doc de viabilidad (línea 29), ahora hay que cerrarlo.

1.1. **Manifest**: nuevo intent-filter en `.MainActivity` (`AndroidManifest.xml`, junto al de OAuth en las líneas 65-70), mismo scheme `yggdrasil`, host distinto: `yggdrasil://voice/listen`. Coexiste sin conflicto con el de `oauth`/`google/callback` porque Android desambigua por host+path, no solo por scheme.

1.2. **Listener global en `main.dart`**: `_YggdrasilAppState` (`lib/main.dart:28`) necesita su propio `AppLinks()` en `initState` (línea 50), igual que hace `GoogleConnectorScreen` pero a nivel de toda la app: `getInitialLink()` para el caso "la app estaba cerrada y la abrió la notificación" + `uriLinkStream.listen` para el caso "la app ya estaba abierta". Filtra por `uri.host == 'voice' && uri.path == '/listen'` (dejando pasar el de `oauth` sin tocarlo, que sigue resolviéndose donde ya se resuelve, local a `GoogleConnectorScreen`).

1.3. **El problema real: cómo le "avisás" al `VoiceMicButton` que está montado ahora mismo.** `ComposerBar` (y con él `VoiceMicButton`) se reinstancia en cada pantalla que lo usa (home, chat, direct-chat) — `main.dart` no tiene una referencia directa al que está visible en cada momento, ni debería (acoplaría el shell de la app al detalle de qué pantalla dibuja el composer). Propongo un **bus mínimo** en vez de `GlobalKey`s cruzando 3 pantallas:

   - Un `ValueNotifier<int>` de alcance de app (ej. en un archivo nuevo `lib/services/voice_trigger_bus.dart`) que arranca en 0 y se incrementa cada vez que llega el deep link.
   - `_VoiceMicButtonState.initState` (`voice_mic_button.dart:46`) se suscribe a ese notifier y, cuando cambia, llama exactamente a `_onMicTap()` — la misma función que ya corre en el tap manual (línea 52), así que hereda gratis el guard de `!widget.enabled` (línea 57, turno en curso) y el resto del flujo (permiso, sheet, etc.) sin duplicar lógica.
   - **Caso "app recién abierta por la notificación" (cold start)**: el `ComposerBar` de la pantalla inicial recién se monta *después* de que el deep link ya disparó el bump del notifier (la app tarda en conectar — ver `main.dart:53` `_connectFuture`). Un `ValueNotifier` nuevo con `addListener` no dispara para cambios pasados, solo futuros — así que `VoiceMicButton.initState` tiene que comparar el valor *actual* del notifier contra un contador local al montarse (no solo escuchar cambios futuros), para no perder el evento si llegó antes de que el widget existiera. Esto es un detalle de implementación a validar con Frontend, lo dejo marcado acá porque cambia el contrato del bus (necesita exponer el valor actual leíble, no solo el stream de cambios — lo cual un `ValueNotifier` ya da gratis vía `.value`).

## 2. Notificación: nativa vía MethodChannel, no paquete nuevo

Coherente con cómo ya está resuelto todo lo demás específico de plataforma en este proyecto (SAF pickers, alarma, calendario, MediaStore — todo `MainActivity.kt` + `device_tools_channel.dart`, cero paquetes Flutter de notificaciones/foreground-service en `pubspec.yaml`): propongo un canal nuevo y separado, `com.yggdrasil.app/voice_notification`, en vez de sumar `flutter_local_notifications` o meter esto dentro del canal `device_tools` — son conceptualmente distintos (uno es infraestructura de la app, el otro son tools que el modelo invoca).

2.1. **Permiso nuevo**: `POST_NOTIFICATIONS` (Android 13+/API 33+), runtime — pedirlo la primera vez que la app arranca, mismo patrón que ya usa `permission_handler` para `RECORD_AUDIO` en `voice_mic_button.dart:59`. Sumar la declaración en el manifest junto a los permisos existentes (líneas 2-30).

2.2. **Sin `Service`, ni foreground ni normal, para v1** — corregido tras una primera versión de este doc que asumía uno mal. `setOngoing(true)` es un flag de la notificación, no de quién la posta: no hace falta *código corriendo en background* para que una notificación quede marcada ongoing/no-deslizable, solo hace falta postearla. Un `Service` (foreground o no) solo se justifica si necesitás mantener algo *ejecutándose* en background — acá no: nadie escucha nada, nadie sostiene el mic, `SpeechToText` sigue arrancando 100% del lado Flutter recién cuando `VoiceMicButton` recibe el disparo (tap manual o deep link, §1). Por eso tampoco aplica nada de `FOREGROUND_SERVICE`/`foregroundServiceType` (eso es exclusivo del wake word real de §1 del doc de viabilidad, que si necesita sostener el mic activo).
   - **Riesgo real, no escondido**: sin un `Service` sosteniéndola, no hay garantía de que Android nunca la mate — si el sistema mata el proceso de la app en background por tiempo/memoria, la notificación puede desaparecer con él. Es exactamente el trade-off que el doc de viabilidad ya nombraba (línea 51) como aceptable para arrancar. La señal de que hay que escalar a foreground service (v1.1) es que esto pase seguido en el uso real — no algo a resolver de antemano sin datos.

2.3. **Notificación ongoing + accionable**: `NotificationCompat.Builder` con `setOngoing(true)` (no deslizable), posteada vía `NotificationManagerCompat.notify(...)` desde `MainActivity` (§2.4) — sin servicio de por medio —, con:
   - `setContentIntent(...)` → `PendingIntent` que abre `yggdrasil://voice/listen` — tocar el cuerpo dispara el flujo.
   - `addAction(...)` con el mismo `PendingIntent` (o uno equivalente) para el botón explícito — mismo deep link, mismo destino, no hace falta lógica separada entre "tocaste el cuerpo" y "tocaste el botón": los dos caen en el mismo intent-filter de §1.1 y terminan en el mismo bump del bus de §1.3.
   - Canal de notificación (`NotificationChannel`, API 26+) con importancia suficiente para que no quede colapsada/agrupada de forma silenciosa en Android reciente — a verificar en el Samsung real qué tan "prominente" se ve en la práctica (One UI reordena/agrupa notificaciones a su criterio, mismo tipo de sorpresa de OEM que ya pasó con `ACTION_SET_ALARM` y el permiso no documentado de Samsung — no asumir que se ve igual que en AOSP puro sin probarlo).

2.4. **Cuándo se posta**: propongo que `MainActivity.onCreate` (o `configureFlutterEngine`, `MainActivity.kt:39`) postee la notificación la primera vez que la app se abre después de instalada — no antes (no hay forma de mostrar una notificación de una app que el usuario nunca abrió). Sin servicio de por medio, tampoco hay nada que "sobreviva" o no a un reinicio del teléfono en sentido estricto — la notificación simplemente no vuelve a aparecer sola tras un reboot hasta que el usuario abra la app de nuevo (mismo evento que la posteó la primera vez). No hace falta `BOOT_COMPLETED` ni el permiso que eso pediría — se resuelve solo, gratis, por ser este el mismo punto de entrada que ya la posta.

## 3. Qué pasa si el turno está en curso

`_onMicTap` ya vuelve sin hacer nada si `widget.enabled` es falso (`voice_mic_button.dart:57`, composer bloqueado durante un turno) — el disparo por deep link hereda ese mismo guard porque llama a la misma función (§1.3). Hoy ese caso no da ningún feedback visual cuando es un tap manual tampoco (el botón simplemente no reacciona, visible atenuado por la opacidad de `widget.enabled` en pantalla — línea 82). Para el disparo por notificación esto es menos obvio para el usuario (no está mirando el botón atenuado, venía de la bandeja) — marco esto como punto de UX a decidir con Frontend en la próxima etapa, no lo resuelvo acá.

## 4. Qué NO cambia

- Nada de `speech_to_text`, `permission_handler`, ni el sheet de grabación (`_VoiceSheet`, `voice_mic_button.dart:111-379`) se toca — toda esta ronda es superficie de disparo nueva sobre el flujo ya existente, tal como estableció §0 del doc de viabilidad.
- El intent-filter de OAuth (`AndroidManifest.xml:65-70`) y su listener local en `GoogleConnectorScreen` quedan intactos — el nuevo host `voice` convive con `oauth` sin pisarlo.

## 5. Resumen de piezas nuevas

| Pieza | Dónde | Tipo |
|---|---|---|
| Intent-filter `yggdrasil://voice/listen` | `AndroidManifest.xml` | Manifest |
| Permiso `POST_NOTIFICATIONS` | `AndroidManifest.xml` | Manifest |
| Listener global de deep link | `lib/main.dart` (`_YggdrasilAppState.initState`) | Dart |
| Bus de disparo (`ValueNotifier<int>`) | `lib/services/voice_trigger_bus.dart` (nuevo) | Dart |
| Suscripción del bus + comparación de valor inicial | `lib/chat/voice_mic_button.dart` (`_VoiceMicButtonState`) | Dart |
| Notificación ongoing + acción (`NotificationCompat`, sin `Service`) | Kotlin, en `MainActivity.kt` o helper nuevo junto a él | Kotlin |
| Canal nuevo `com.yggdrasil.app/voice_notification` | `lib/services/` (nuevo) + `MainActivity.kt` | Dart + Kotlin |
| Postear la notificación al abrir la app | `MainActivity.kt` (`onCreate`/`configureFlutterEngine`) | Kotlin |

## 6. Abierto para el usuario (no asumido, no decidido en esta ronda)

1. Si la notificación se pierde/la mata Android en background con frecuencia en el uso real, ¿escalamos a foreground service (v1.1)? — §2.2, no se resuelve ahora, se mide primero.
2. Feedback cuando el disparo llega con un turno en curso — §3, para Frontend.
3. Nombre/copy exacto de la notificación y del canal — texto visible al usuario, no lo inventé acá.

---
Generado con Claude Code — sesión: https://claude.ai/code/session_01WYAisFZiCxEX1YPyCKM7P7
