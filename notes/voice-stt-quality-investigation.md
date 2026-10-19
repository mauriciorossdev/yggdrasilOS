# STT quality — investigación y propuesta (voice_mic_button.dart)

Paquete: `speech_to_text ^7.4.0` (lockfile: 7.4.0), Android usa
`speech_to_text_platform_interface 2.4.0` + reconocedor nativo Android
(`SpeechRecognizer`, vía `com.csdcorp.speech_to_text.SpeechToTextPlugin`).
Fuente del paquete inspeccionada directo en pub-cache para confirmar
firmas reales (no supuestos).

Archivo objetivo: `mobile/app/lib/chat/voice_mic_button.dart`.
§1-§4 implementados (commits 8495310, 1c8f72b) y validados en Samsung
real. §2 cerrado (es-CL confirmado ausente, ver nota en §2). §5 es
hallazgo nuevo del mismo Samsung real, sin implementar — propuesta lista
para Frontend.

---

## 1. onError — falta en initialize()/listen()

**API real:** `onError` es parámetro de `SpeechToText.initialize()`
(`SpeechErrorListener? onError`), NO de `listen()`. Se registra una sola
vez (`errorListener = onError` en `speech_to_text.dart:318`) y queda
activo para todas las sesiones de escucha subsiguientes. `listen()` no
tiene ni tuvo nunca ese parámetro — no hay nada roto ahí, solo falta
pasarlo en `initialize()` (línea ~102 del archivo).

**Forma del error:** `SpeechRecognitionError { String errorMsg; bool permanent; }`.
`errorMsg` es un string plano, no un enum. En Android
(`SpeechToTextPlugin.kt:761-776`) los valores posibles son:

```
error_audio_error, error_client, error_permission, error_network,
error_network_timeout, error_no_match, error_busy, error_server,
error_speech_timeout, error_language_not_supported,
error_language_unavailable, error_server_disconnected,
error_too_many_requests, error_unknown ($code)
```

**Hallazgo importante (bug del plugin):** `sendError()` siempre manda
`permanent: true` sin importar el tipo de error
(`SpeechToTextPlugin.kt:793` — hardcodeado, no depende del errorCode).
No confiar en `error.permanent` para decidir UX — hay que switchear
sobre el string `errorMsg`.

**Otro hallazgo útil:** el propio plugin ya distingue "no escuché nada"
de "escuché pero no entendí" a nivel de error — si `ERROR_NO_MATCH`
llega con `maxRms < speechThresholdRms` (poco volumen detectado), lo
remapea a `error_speech_timeout` antes de mandarlo (líneas 757-758). O
sea la señal que pide el punto 4 ya existe parcialmente del lado nativo;
onSoundLevelChange la complementa en tiempo real (ver punto 4).

**Propuesta de mapeo UX** (agregar `onError` a `initialize()`,
switch sobre `errorMsg`):

| errorMsg | Causa real | Mensaje al usuario |
|---|---|---|
| `error_permission` | Recognizer nativo negó permiso (raro, ya pedimos runtime permission antes) | mismo flujo que `_TriggerState.errorPermission` (mic_off + abrir ajustes) |
| `error_speech_timeout` | Silencio / no captó volumen | "No te escuché, probá de nuevo" |
| `error_no_match` | Captó audio pero no reconoció palabras | "No entendí lo que dijiste" |
| `error_network`, `error_network_timeout`, `error_server`, `error_server_disconnected` | Reconocimiento requiere red (no es on-device) y falló | "Sin conexión, revisá tu internet" |
| `error_busy`, `error_too_many_requests` | Recognizer ocupado/rate-limited | "Probá de nuevo en un momento" |
| `error_language_unavailable` | Language pack on-device (SODA) no descargado/falló la carga para el locale pedido | "El idioma no está descargado, revisá tu conexión" — ver §5 |
| `error_audio_error`, `error_client`, `error_language_not_supported`, `error_unknown` | Casos raros/no accionables | fallback al texto genérico actual (`voice.notUnderstood`) |

Implementación: el callback de error debe cancelar `_maxDurationTimer`,
setear un mensaje en `_VoiceSheetView` (nuevo campo, no el string fijo
de `_SheetMode.notUnderstood`) y disparar `_scheduleAutoClose()`. Como
`errorListener` vive en `initialize()` y este widget re-crea el sheet
por cada tap, alcanza con pasarlo una vez en `_speech.initialize(onError: ...)`
en `_onMicTap` — el callback necesita una referencia mutable a la sheet
activa (o un `ValueNotifier<String?>` de "último error" que la sheet
escuche) ya que `initialize()` corre antes de que exista `_VoiceSheetView`.

Nuevas keys en `AppStrings`: `voice.error.silence`, `voice.error.noMatch`,
`voice.error.network`, `voice.error.busy` (es/en) — reemplazan el
`voice.notUnderstood` genérico para estos casos puntuales, sin sacar el
genérico (sigue de fallback y para el `text.isEmpty` sin error explícito).

---

## 2. localeId — debe seguir AppStrings.localeNotifier, no el sistema

Confirmado: ni `initialize()` ni el `listen()`/`SpeechListenOptions`
actual pasan `localeId` → usa el default del dispositivo. `initialize()`
NO tiene parámetro `localeId` (solo `onError`/`onStatus`/`debugLogging`/
`finalTimeout`/`options`) — el locale se fija exclusivamente vía
`SpeechListenOptions.localeId` en `listen()` (línea ~235-240).

`AppStrings.localeNotifier` (`lib/l10n/app_strings.dart:17`) ya existe,
valores `'es'`/`'en'`, default `'es'`. Corrección del usuario aplicada:
mapear desde ahí, no desde el locale de sistema.

**Propuesta:** resolver el `localeId` real llamando
`_speech.locales()` (`List<LocaleName>`, disponible recién después de
`initialize()` exitoso) y eligiendo por prioridad sobre los códigos que
esa lista realmente ofrezca en el device — no hardcodear a ciegas,
porque `es-CL` puede no estar en cualquier Samsung/versión de Google App:

```dart
Future<String?> _resolveLocaleId() async {
  final available = await _speech.locales(); // List<LocaleName>
  final ids = available.map((l) => l.localeId).toSet();
  final candidates = AppStrings.current == 'en'
      ? const ['en-US', 'en-GB']
      : const ['es-CL', 'es-ES', 'es-419', 'es-US'];
  for (final c in candidates) {
    if (ids.contains(c)) return c;
  }
  // fallback: primer locale que empiece con el idioma de la app
  final prefix = AppStrings.current == 'en' ? 'en' : 'es';
  return ids.firstWhere((id) => id.startsWith(prefix), orElse: () => ids.isEmpty ? '' : available.first.localeId);
}
```

`es-CL` va primero en la lista de candidatos (usuario en Chile) pero la
elección final la decide lo que `locales()` devuelva en el Samsung real
— si `es-CL` no está listado, cae a `es-ES`/`es-419`.

**CERRADO — confirmado en hardware real (Samsung, logcat 2026-09-07):**
`_speech.locales()` en ese device devuelve: `cmn_CN, cmn_TW, en_AU, en_CA,
en_IN, en_IE, en_SG, en_GB, en_US, fr_BE, fr_CA, fr_FR, fr_CH, de_AT,
de_BE, de_DE, de_CH, hi_IN, in_ID, it_IT, it_CH, ja_JP, ko_KR, pl_PL,
pt_BR, ru_RU, es_ES, es_US, th_TH, tr_TR, vi_VN`. **`es_CL` NO está en la
lista** — no es una opción en este device (Google App / versión de
Android instalada). La elección real cae a `es-ES` (primer match de la
lista de candidatos), con `es-US` de fallback siguiente. El código en
`voice_mic_button.dart:104-106` tiene un `TODO(frontend): confirm on the
real Samsung...` sobre este punto — dar por cerrado con este dato,
`es-CL` no existe, no hace falta seguir "confirmando", el comentario
puede borrarse la próxima vez que se toque ese archivo.

Wiring: resolver el localeId en `_onMicTap` (después de `initialize()`,
antes de abrir la sheet) y pasarlo a `_startListening()` →
`SpeechListenOptions(localeId: resolvedLocaleId, ...)`.

No cachear de forma agresiva entre taps — el usuario puede cambiar el
idioma de la app en Configuración entre un tap y otro, así que resolver
fresco en cada `_onMicTap` es más simple y correcto que invalidar una
cache manualmente (costo del roundtrip de `locales()` es bajo, no
justifica la complejidad extra).

---

## 3. pauseFor: 3s — evaluación

Confirmado en `SpeechListenOptions.pauseFor` (paquete): "length of time
to pause before the speech input is considered complete". 3s corta
pausas naturales a mitad de frase (alguien pensando qué decir).

**Propuesta:** subir a 5s. No toca `listenFor`/el timer de 30s
(`_maxDurationTimer` sigue siendo el techo duro). Riesgo bajo: si el
pause dispara un corte anticipado pero `_liveText` ya tiene contenido,
el flujo existente en `_stopAndTranscribe` ya maneja bien ese caso (usa
lo que haya en `_liveText`, no es un error). Cambio de una sola
constante, línea ~239.

---

## 4. onSoundLevelChange: null — sin feedback de audio real

**Tipo confirmado:** `typedef SpeechSoundLevelChange = Function(double level)`
— nivel RMS/dB que manda la plataforma en cada frame de audio mientras
escucha.

**Dos usos concretos:**

a) **Waveform real en vez de decorativo.** Hoy las 7 barras
(`_barControllers`) animan con duraciones/delays hardcodeados
(`_barDurationsMs`/`_barDelaysMs`) sin relación al audio real — es
puramente cosmético. Wirear `onSoundLevelChange` para que el `level`
normalizado module la escala de las barras (además o en vez de la
animación fija) da al usuario confirmación real de "el micrófono me está
escuchando" en vivo, no solo una animación de loop.

b) **Distinguir silencio de "no entendí" sin depender solo del error del
punto 1.** Trackear un flag `_heardAnySound` (o el máximo de `level`
visto en la sesión) durante el listen. Si `_stopAndTranscribe` corre con
`_liveText` vacío Y `_heardAnySound == false` → mostrar el mensaje de
silencio (`voice.error.silence`, mismo string que el caso
`error_speech_timeout` del punto 1) en vez del genérico
`voice.notUnderstood`. Esto cubre el caso borde donde el motor nunca
manda `onError` (p.ej. el usuario corta manualmente tocando el backdrop
antes de que el recognizer detecte nada) — sin punto 4 esa rama no tiene
forma de saber si hubo audio o no.

Wiring: pasar `onSoundLevelChange: _onLevel` en `listen()` (línea ~234),
`_onLevel(double level)` actualiza `_heardAnySound` (umbral a calibrar
en el device real — Android manda valores típicamente entre -2 y ~10+ dB
según el plugin, no hay una constante fija documentada) y opcionalmente
un `ValueNotifier<double>` para el waveform si Frontend decide wirearlo
también a la animación visual.

---

## 5. error_language_unavailable (SODA language pack no descargado) — CONFIRMADO en hardware real, punto nuevo, sin implementar

**Hallazgo (Samsung real, logcat 2026-09-07):** apareció
`"SodaSpeechRecognizer: Failed to get language pack of required locale:
error 13"` al pedir `es-ES` — el motor on-device (SODA, Google) no tenía
el paquete de idioma descargado en ese momento y falló la carga. Es
candidato real a explicar el síntoma reportado de "a veces no escucha"
(primer uso sin red, descarga de paquete interrumpida, paquete borrado
por el sistema para liberar espacio, etc.) — no es ruido, es un fallo
intermitente real y reproducible.

**Confirmado en el código fuente del plugin** (no inferido — mapeo
explícito en `SpeechToTextPlugin.kt:754-776`, revisado directo en
pub-cache):

```kotlin
SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "error_language_unavailable"
```

Android `SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE == 13` — coincide
exacto con el "error 13" del log. El plugin YA emite un `errorMsg`
distinguible (`"error_language_unavailable"`) para este caso, no hace
falta parsear texto libre ni inferir nada indirecto — es un valor de
switch más, igual que los demás.

**Estado actual del código (confirmado leyendo
`voice_mic_button.dart:339-356`, `_keyForError`):** el switch NO tiene
case para `error_language_unavailable` — cae al `default: return null`
(el mismo comentario en el código lo agrupa explícitamente bajo
"error_language_*" → fallback genérico). Hoy este fallo se muestra como
`voice.notUnderstood` ("No se entendió, inténtalo de nuevo"), un mensaje
que no orienta al usuario sobre la causa real (idioma no descargado) ni
sugiere la acción correcta (esperar a que descargue / revisar conexión).

**Propuesta:**
- Nuevo case en `_keyForError`: `case 'error_language_unavailable': return 'voice.error.languageUnavailable';`
- Nueva key en `AppStrings`: `voice.error.languageUnavailable` — es: "El
  idioma no está descargado, revisá tu conexión", en: "Language pack not
  downloaded, check your connection". (Mismo patrón/estilo que las 4 keys
  ya agregadas para §1, ver `app_strings.dart:132-135`.)
- No es distinguible de `error_language_not_supported` a simple vista
  para el usuario común, pero SÍ conviene separarlos en el código:
  `error_language_not_supported` (locale no existe en el device, caso
  cerrado por §2 ya que se resuelve eligiendo entre los que sí existen)
  sigue en el fallback genérico; `error_language_unavailable` (locale
  válido pero paquete no descargado) es el caso nuevo, accionable,
  transitorio — amerita mensaje propio.

**Alcance del cambio:** chico, mismo patrón que los otros 4 errores de
§1 — un case más en el switch + una key más en `AppStrings`. No requiere
tocar `_onSpeechError`/wiring/timers, esa plomería ya existe (implementada
en 1c8f72b). Frontend puede sumarlo en la misma pasada que toque
`_keyForError` de nuevo, o como cambio aislado de una línea + una entry
en `AppStrings._strings`.

---

## Resumen de cambios (para Frontend)

1. `_speech.initialize(onError: _onSpeechError)` — nuevo método que
   mapea `errorMsg` → mensaje UX (tabla arriba), cancela el timer de 30s,
   corta a modo error con auto-close.
2. Nuevas keys en `AppStrings._strings`: `voice.error.silence`,
   `voice.error.noMatch`, `voice.error.network`, `voice.error.busy`
   (es/en).
3. `_resolveLocaleId()` async antes de `_startListening()`, resultado →
   `SpeechListenOptions(localeId: ...)`. Confirmar en device real qué
   locale IDs devuelve `_speech.locales()` para es-CL antes de cerrar la
   lista de candidatos.
4. `pauseFor: const Duration(seconds: 5)` (era 3).
5. `onSoundLevelChange: _onLevel` — trackea `_heardAnySound` y
   (opcional, a criterio de UX/Frontend) alimenta el waveform real.
6. **[CONFIRMADO §5, pendiente]** `_keyForError`: agregar case
   `error_language_unavailable` → nueva key `voice.error.languageUnavailable`
   (es/en) — SODA language pack no descargado, causa real de fallo
   intermitente confirmada en Samsung real vía logcat.

No es una sola línea por punto — los puntos 1 y 4 tocan el manejo de
estado de `_VoiceSheetView` (nuevo campo de mensaje de error, flag de
sonido detectado). Punto 2 agrega una llamada async antes de listen().
Punto 3 es el único cambio de una sola constante.
