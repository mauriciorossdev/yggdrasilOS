# Rol Assistant de Android para Yggdrasil Mobile — investigación

Fecha: 2026-09-09

## Contexto

Se evaluó llevar la app mobile a un rol más profundo del sistema Android, en dos niveles: (1) reemplazar el launcher (pantalla de inicio), y (2) registrarla como el Digital Assistant del teléfono (invocable con gesto/long-press home, como Google Assistant o Bixby).

## Launcher — descartado

Un launcher reemplaza toda la pantalla de inicio de Android: grid de íconos, app drawer, wallpaper, gestos. Es una app completamente distinta a lo que existe hoy, casi una reescritura, con riesgo alto (un crash rompe la experiencia base del teléfono) y poca relación real con el objetivo de "ser un asistente". **Recomendación: no seguir este camino.**

## Rol Assistant (VoiceInteractionService) — evaluado

### Qué exige

- Una app que se registra como Voice Interaction App (VIA) debe implementar **tanto** `VoiceInteractionService` **como** `RecognitionService` — confirmado que Google no desacopla esto por diseño (no es negociable).
- Solo **una** VIA puede estar activa a la vez en el sistema — activar Yggdrasil como assistant reemplaza completamente a Bixby/Google Assistant, no coexisten.
- El sistema mantiene la VIA activa **corriendo siempre** en background (para detección de hotword), con la recomendación explícita de Google de mantenerla lo más liviana posible — carga de batería/recursos permanente.
- Samsung/One UI sí permite elegir un assistant de terceros (Settings → Apps → Choose default apps → Digital assistant app), pero hay reportes de bugs donde esto no funciona en modelos/versiones recientes (ej. Galaxy A56 con Android 15/One UI 7) — riesgo real de que falle en hardware específico, no garantizado funcionar en todos los Samsung.

### RecognitionService — qué es y opciones

`RecognitionService` es el motor de voz-a-texto que la app expone a nivel sistema (lo que cualquier app usa al llamar `SpeechRecognizer` — hoy Android usa el de Google, que es lo mismo que ya usa `speech_to_text` en esta app). Si la app es el Assistant, tiene que proveer este servicio ella misma. Opciones:

1. **Envolver el reconocedor que ya usa Android (Google)** — costo $0, poco código nuevo (solo la clase puente).
2. **Motor propio on-device** (ej. Whisper.cpp) — $0 en licencia, pero más batería/CPU, y la integración a Android requiere JNI (no hay plugin Flutter directo).
3. **API en la nube** (Google Cloud Speech-to-Text, Azure Speech) — pago por minuto de audio, mejor precisión en dominios específicos, necesita red.

### Hotword ("Hey Yggdrasil" sin tocar nada) — pieza aparte

Separado del RecognitionService — dispara la sesión de voz antes de que empiece a reconocer:

- **Porcupine (Picovoice)** — comercial, arranca en US$6.000/año (plan Starter, 100 dispositivos activos/mes) — sin sentido de costo para un solo teléfono personal.
- **openWakeWord** — gratis, open source, según lo relevado incluso más preciso que Porcupine. Opción sensata si se quisiera hotword real.

### Costo real

No es de plata (con las opciones gratis, el costo en licencias es $0) — es **tiempo de ingeniería**: escribir la clase `RecognitionService` + el ciclo de vida completo de `VoiceInteractionService` en Kotlin nativo es trabajo real de sistemas Android, sustancialmente más grande que cualquier feature construida hasta ahora en esta app (widgets, deep links, notificación persistente).

## Recomendación

No seguir con el rol Assistant por ahora. Lo que el usuario buscaba (invocar la app desde cualquier lado del teléfono) ya está cubierto, mucho más barato, con lo que ya existe: widgets de home screen (Mic + Proyectos), la notificación persistente de tap-to-listen, y los deep links (`yggdrasil://voice/listen`, `yggdrasil://projects`). Reevaluar el rol Assistant solo si en algún momento el requisito real pasa a ser "manos libres con hotword, reemplazando Bixby por completo" — no antes.

## Fuentes

- https://source.android.com/docs/automotive/voice/voice_interaction_guide/app_development
- https://source.android.com/docs/automotive/voice/voice_interaction_guide
- https://github.com/home-assistant/android/discussions/5974
- https://www.samsung.com/us/support/answer/ANS10001575/
- https://forums.androidcentral.com/threads/samsung-a56-disable-assistant-google-on-home-button-has-no-effect.1078624/
- https://picovoice.ai/products/voice/wake-word/
- https://github.com/dscripka/openWakeWord
