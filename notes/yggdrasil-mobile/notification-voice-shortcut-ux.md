# UX: Notificación persistente de acceso rápido a voz (sin foreground service)

Estado: **propuesta de flujo, sin implementar.** Cierra la parte de UX de la opción elegida en `voice-activation-without-touch-viability.md` §2.2 (notificación persistente, sin foreground service en v1) — Architect cierra el diseño técnico nativo en paralelo, este doc no toca código ni decide mecanismo interno.
Basado en: `voice-activation-without-touch-viability.md` (investigación de viabilidad, decisión de arrancar sin foreground service) + `home-screen-voice-input-ux.md` §6 (sheet de voz ya construido, con su propio cancel/auto-close) + `capabilities-settings-ux.md` §1/§4/§5 (patrones ya usados en este proyecto para toggles, permisos runtime y recuperación de error) + lectura de `voice_mic_button.dart`, `composer_bar.dart` y `settings_screen.dart`.

## 0. Punto de partida

- La notificación dispara el mismo flujo que ya existe hoy: tocar el botón de acción de la notificación → deep link → mismo `_onMicTap`/sheet de `voice_mic_button.dart` que ya usa el botón de mic manual (`composer_bar.dart:111-122`, único punto de disparo hoy). No hay pipeline de audio nuevo, solo una superficie de disparo nueva — mismo criterio que `voice-activation-without-touch-viability.md` §0 ya estableció para las 3 alternativas.
- El sheet de voz (`home-screen-voice-input-ux.md` §6.2) ya tiene: botón "Cancelar" siempre visible, tap en el backdrop/card durante grabación corta antes (`voice_mic_button.dart:246-251,266`), auto-cierre a los ~2.5s si no hay texto reconocido (`_scheduleAutoClose`, `voice_mic_button.dart:227-232`), y límite duro de 30s (`_maxDurationTimer`, `voice_mic_button.dart:192`). Esto importa para el punto 5 — no hay que diseñar nada nuevo ahí, ya existe.
- `AndroidManifest.xml` hoy no declara `POST_NOTIFICATIONS` (confirmado en `voice-activation-without-touch-viability.md` §0, `AndroidManifest.xml:1-15`) — hace falta declararlo y pedirlo en runtime (Android 13+, API 33).
- Sin foreground service, la notificación no puede ser 100% "siempre ahí pase lo que pase" en el sentido estricto — Android puede descartarla si mata el proceso en background por mucho tiempo (mismo trade-off que ya anotó la investigación de viabilidad). El copy de este doc evita prometer una persistencia absoluta que la implementación v1 no garantiza.

---

## 1. Copy de la notificación

- **Ícono de la barra de estado**: silueta simple de mic (monocromo/alpha, como exige Android para status bar icons) — mismo ícono conceptual que `Icons.mic` en `voice_mic_button.dart:94`, para que se lea como "la misma acción de voz que ya conocés del composer".
- **Título**: "Yggdrasil"
- **Texto**: "Tocá para hablar" — corto, en modo imperativo suave, sin signos de exclamación ni tono de alerta. Evito algo tipo "¡Preguntale algo a Yggdrasil!" porque va a estar en la bandeja todos los días — cuanto más se parezca a una alerta, más cansa con el uso diario.
- **Prioridad**: baja (`IMPORTANCE_LOW` / `PRIORITY_LOW`) — sin sonido, sin vibración, sin heads-up, se asienta abajo del shade sin interrumpir. Es un atajo disponible, no un evento que requiera atención.
- **Sin badge/contador** — no hay nada que contar, es un botón fijo, no un feed de novedades.
- **Comportamiento al deslizar (swipe)**: si el usuario la descarta manualmente, no se debería re-postear sola en el momento — reaparece recién la próxima vez que la app pasa a foreground (mismo criterio de "no service"). Si eso en la práctica resulta muy inconsistente (aparece y desaparece según cuándo se abrió la app la última vez), es la señal concreta para subir a foreground service que ya anotó la investigación de viabilidad — no algo que UX deba resolver de antemano.

---

## 2. Onboarding

**No hay tutorial ni pantalla explicativa al abrir la app.** Mismo criterio que ya se usó para el botón de mic manual: `home-screen-voice-input-ux.md` no define ningún onboarding para ese botón — simplemente está visible en el home y se explica solo (ícono de mic reconocible). Forzar una pantalla de bienvenida nueva para esto sería más ceremonia que la que tiene la feature original que dispara.

**Punto de oferta: después del primer uso exitoso del mic manual**, no al primer `open` de la app. Concretamente: la primera vez que `onRecognized` se dispara con texto no vacío y el mensaje se manda (`composer_bar.dart:121`, `onRecognized: widget.onSubmit`), sea desde home o desde chat — ahí, y no antes, el usuario ya demostró que el flujo de voz le sirve, es el momento de más sentido para ofrecer un atajo más rápido al mismo flujo.

Mecanismo: un banner/snackbar chico, no bloqueante, con dos acciones — "Activar acceso rápido" / descartar (X o "Ahora no") — mostrado **una sola vez en la vida de la instalación**, con un flag local persistido (mismo patrón de estado local que ya usa `CapabilitiesStore` para los toggles de capacidades). Si el usuario lo acepta, dispara directo el pedido de `POST_NOTIFICATIONS` (ver §4 para el caso de rechazo del permiso). Si lo descarta, no se vuelve a ofrecer solo — la feature queda disponible y descubrible en Configuración (§3) para quien cambie de opinión después. Esto es consistente con el criterio ya aplicado en `capabilities-settings-ux.md` §5 (sin fricción para prender/apagar, sin insistir).

---

## 3. Control del usuario — dónde vive

**No va dentro de la pantalla "Capacidades".** Esa pantalla (`capabilities-settings-ux.md` §0/§1) controla específicamente qué `phone_*` tools puede invocar **el modelo** — son acciones que el modelo decide disparar durante una conversación. La notificación de acceso rápido es lo opuesto: una conveniencia de UI que **el usuario** dispara hacia la app, el modelo no sabe que existe ni la puede prender/apagar. Meterla en Capacidades mezclaría dos sistemas distintos — el mismo argumento que ese doc ya usó para mantener afuera a los conectores de Google (`capabilities-settings-ux.md` §1: "mezclaría dos sistemas distintos... el mismo tipo de conflación que settings-consolidation-proposal.md §0 ya identificó y separó").

**Dónde va**: fila nueva en Configuración → sección General (`settings_screen.dart:253-262`, misma sección donde vive hoy "Perfiles de conexión"), ej.:

```
GENERAL
├ Acceso rápido por voz          [ON/OFF]
│  Notificación para hablar sin abrir la app
├ Perfiles de conexión
```

- Switch directo en la fila (mismo patrón visual que Capacidades, sin confirmación al apagar — `capabilities-settings-ux.md` §5: "prender de nuevo el switch es inmediato y sin costo").
- Apagar el switch **cancela/retira la notificación de inmediato** — feedback visible de que el toggle hizo algo, sin esperar a que el usuario minimice la app.
- Prender el switch desde acá (fuera del flujo de onboarding de §2) dispara el mismo pedido de `POST_NOTIFICATIONS` si todavía no se concedió — es el mismo mecanismo de "pedir el permiso en el momento en que el usuario ya está en un contexto explícito de configuración" que `capabilities-settings-ux.md` §4 ya usa para `phone_find_files`.

---

## 4. Permiso de notificaciones negado

Mismo patrón de recuperación que ya está decidido en este proyecto para permisos denegados (`capabilities-settings-ux.md` §4, y `voice_mic_button.dart:52-64` para el permiso de mic):

- El switch **vuelve a OFF automáticamente** si Android deniega `POST_NOTIFICATIONS` — nunca queda en un estado "ON pero roto" donde el usuario cree que está activo y no lo está.
- Texto corto bajo la fila: *"Sin permiso de notificaciones no puedo mostrar el acceso rápido"* + link "Abrir ajustes" **solo si** el status es `permanentlyDenied` (mismo criterio exacto que `_TriggerState.errorPermission` en `voice_mic_button.dart`, que llama `openAppSettings()`).
- **El resto de la app sigue funcionando sin ningún cambio**: el botón de mic manual (`composer_bar.dart`) no depende de `POST_NOTIFICATIONS` en absoluto, es un permiso completamente aparte del de micrófono. No hay ningún diálogo bloqueante, ningún banner de error persistente en otras pantallas, ningún reintento automático molesto — es exactamente el criterio que ya pidió el usuario ("la app debería seguir funcionando normal, solo sin el atajo").
- Si el rechazo pasa durante la oferta de onboarding (§2) en vez de desde Configuración: se aplica la misma recuperación silenciosa — no se vuelve a ofrecer el banner solo, pero el switch queda visible y disponible en Configuración (§3, en OFF) por si el usuario cambia de idea más adelante y quiere reintentar el permiso a mano.

---

## 5. Tap desde lock screen — sin confirmación extra

**Se abre la app y arranca a escuchar de inmediato, sin pantalla de confirmación intermedia.** Es el mismo criterio que este proyecto ya aplicó dos veces para el flujo de voz: auto-submit sin confirmación al reconocer texto (`home-screen-voice-input-ux.md` §2.4) y el sheet full-screen sin paso intermedio (`home-screen-voice-input-ux.md` §6.2). Agregar una pantalla de "¿querés hablar ahora?" antes de escuchar sería fricción nueva para el 99% de los toques deliberados, solo para cubrir el caso raro de toque accidental — trade-off que este proyecto ya rechazó en el flujo hermano.

**El caso de bolsillo/accidente ya está cubierto por lo que existe, sin diseño nuevo**:
- El sheet solo auto-manda un mensaje si hay texto reconocido no vacío (`voice_mic_button.dart:75`) — un toque de bolsillo capta silencio o ruido, no habla real, así que cae en el estado "No se entendió" y se auto-cierra solo a los ~2.5s (`_scheduleAutoClose`) **sin mandar nada**.
- Tope duro de 30s (`_maxDurationTimer`) evita que quede escuchando indefinidamente aunque el ruido de bolsillo lo mantenga "activo" más de lo esperado — sigue sin mandar nada salvo que haya texto reconocido real.
- El botón "Cancelar" y el tap en backdrop/card (`voice_mic_button.dart:246-251,266`) cubren el caso de toque deliberado pero arrepentido — no aplica al escenario de bolsillo (nadie cancela algo que no sabe que está pasando), pero es la fricción mínima que ya existe para el usuario consciente.

**Punto abierto para Architect, no de UX**: si tocar la acción de la notificación desde la pantalla de bloqueo requiere desbloqueo completo antes de que la app/sheet aparezca, o si puede mostrarse directo sobre la lock screen (`showWhenLocked`/visibility de la notificación) — depende de flags nativos y de si Android/One UI lo permite para una Activity común sin infraestructura extra. Desde UX: lo ideal es que se vea sin desbloqueo completo (es el pedido original), pero si Architect confirma que el dispositivo exige desbloqueo primero, ese desbloqueo ya funciona como la única fricción intencional que hace falta — no se agrega una pantalla de confirmación encima.

---

## 6. Resumen

1. **Copy**: ícono de mic + "Yggdrasil" / "Tocá para hablar", prioridad baja, sin sonido/vibración/badge — atajo disponible, no alerta.
2. **Onboarding**: sin tutorial en el primer open; se ofrece una sola vez, con banner descartable, justo después del primer uso exitoso del mic manual (`composer_bar.dart:121`) — mismo criterio de "sin ceremonia" que ya tiene el botón original.
3. **Control**: switch propio en Configuración → General (junto a "Perfiles de conexión"), **no** en Capacidades — Capacidades controla lo que puede hacer el modelo, esto es una conveniencia de UI que el usuario dispara, mezclarlos conflaciona dos sistemas distintos.
4. **Permiso denegado**: switch vuelve a OFF solo, mensaje corto + "Abrir ajustes" si es denegación permanente, resto de la app sin cambios — el mic manual sigue andando siempre.
5. **Tap desde lock screen**: abre y escucha directo, sin confirmación extra — el propio sheet de voz (silencio → auto-cierre sin mandar nada, tope de 30s, Cancelar) ya cubre el caso de toque accidental sin necesitar diseño nuevo. Si hace falta desbloqueo previo del dispositivo, eso ya es la fricción suficiente — queda a confirmar con Architect si la plataforma lo exige.

---
Generado con Claude Code — sesión: https://claude.ai/code/session_01Jb1PaJb4G6NuryKMPRZAQh
