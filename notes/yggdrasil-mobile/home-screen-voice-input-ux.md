# UX: Home screen redesign — fondo verde, input pill, entrada de voz (STT)

Estado: base implementada y probada end-to-end en `lib/chat/empty_composer.dart` (`EmptyComposer`, extraído de `chat_list_screen.dart` por Frontend). §5 agregó el ajuste de layout/tamaño (mic debajo de Empezar, más grande) + reuso en `chat_screen.dart`. **§6 (2026-09-04) reconcilia la feedback de grabación con el diseño de referencia de Claude Design — reemplaza la parte de §2/§5 sobre qué se ve DESPUÉS de tocar el botón (pulso+timer → sheet full-screen con waveform).** El trigger (botón dedicado, tamaños de §5) no cambia. Leer §6 antes de portar esto a Flutter — es la versión vigente de ese pedazo.
Alcance original: `chat_list_screen.dart:438-469` (`_buildEmptyComposer`, la pantalla que se ve con 0 sesiones — ícono + input + "Empezar"). No toca la lista de chats con sesiones (esa pantalla es aparte, `build()` línea 387+, fuera de este pedido).

## 0. Punto de partida (leído del código)

- Tema: `main.dart:127`, `ThemeData(colorSchemeSeed: Colors.teal, useMaterial3: true)`. Material 3 genera el `ColorScheme` completo a partir de esa seed — no hay un verde hardcodeado en ningún lado, es `colorScheme.primary`.
- El "verde del texto de Empezar" que menciona el usuario **es `colorScheme.primary`** — el `ElevatedButton.icon` de M3 por default pinta fondo en `colorScheme.surface` (blanco/casi blanco) y texto+ícono en `colorScheme.primary` (ese verde). No hay ningún color nuevo que definir — el pedido "1" es literal: `Container(color: Theme.of(context).colorScheme.primary)` de fondo, mismo scheme, cero cambios de paleta.
- Ícono actual: `Icons.forest_outlined`, coloreado también en `colorScheme.primary` (línea 452) — **eso deja de funcionar solo** en cuanto el fondo pase a ser ese mismo verde (ícono invisible, verde sobre verde). Ajuste obligado, no opcional — ver §1.
- Input actual: `TextField` con `OutlineInputBorder()` (esquinas cuadradas, sin fill) — pedido "2" es cambiar el borde a full pill.
- No hay ningún paquete de STT/mic en `pubspec.yaml` todavía — lo agrega Frontend. `speech_to_text` es el estándar de facto en Flutter (nativo iOS/Android, sin dependencia de red) y su API (`listen(onResult, partialResults)`, `statusListener`, `errorListener`) calza directo con la máquina de estados de §3 — lo menciono para que el diseño de abajo sea implementable sin re-pensar la forma, no para forzar el paquete si Frontend prefiere otro con capacidades equivalentes (resultados parciales + status + error).

---

## 1. Layout general

```
┌─────────────────────────────────────┐
│                                       │  ← fondo sólido: colorScheme.primary
│                                       │     (todo el Scaffold, no solo esta
│                                       │     zona — reemplaza el blanco/gris
│              🌲                       │     default del Scaffold para esta
│                                       │     pantalla puntual)
│      (ícono en colorScheme.onPrimary  │
│       — antes era primary, tiene que  │
│       invertir o desaparece)          │
│                                       │
│   ╭─────────────────────────────╮    │  ← input PILL: fill blanco/surface,
│   │ Preguntale algo a Yggdrasil │    │     borderRadius total (999), sin
│   ╰─────────────────────────────╯    │     borde visible, sombra sutil para
│                                       │     separarse del fondo verde
│      ╭──────────╮   ╭───╮            │
│      │ ➤ Empezar │   │ 🎤 │            │  ← Empezar sigue igual (superficie
│      ╰──────────╯   ╰───╯            │     blanca + texto/ícono verde) —
│                                       │     ya contrasta solo por estar
│                                       │     sobre fondo verde. Mic nuevo,
│                                       │     mismo tratamiento visual base.
└─────────────────────────────────────┘
```

- **Fondo**: `colorScheme.primary` en todo el `Scaffold` de esta pantalla (via `backgroundColor` del `Scaffold` o un `Container` que envuelva el `body`), no solo detrás de la columna central — si el fondo default del Scaffold se asoma en los bordes se ve como un bug, no una elección.
- **Ícono del árbol**: pasa a `colorScheme.onPrimary` (el color que M3 ya calcula para que contraste con `primary` — típicamente blanco o casi). No se inventa un color nuevo, se usa el que el `ColorScheme` ya expone para exactamente este caso (texto/ícono sobre superficie `primary`).
- **Input pill**: `TextField` con `filled: true`, `fillColor: colorScheme.surface` (blanco/casi blanco), `border: OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: BorderSide.none)`, y opcionalmente una sombra chica (`Material` con `elevation` envolviendo, o `BoxShadow` sutil) para que no se sienta pegado al fondo. Texto y hint en `colorScheme.onSurface`/`onSurfaceVariant` — negro/gris oscuro sobre blanco, no tocar.
- **Botón Empezar**: sin cambios de estilo — sigue siendo `ElevatedButton.icon` (fondo `surface`, texto/ícono `primary`). Antes competía visualmente con un fondo blanco/gris neutro; ahora, sobre el verde, el contraste mejora solo — es la misma superficie blanca que ya usa el input, se leen como un mismo lenguaje visual (pill blanca + pill blanca).
- **Botón de voz**: circular, **mismo tratamiento base que Empezar en reposo** (fondo `surface`, ícono `primary`) — ver §2 para todos sus estados. Va al lado de Empezar, mismo alto, tamaño cuadrado (ancho = alto) para que se lea como acción secundaria de igual jerarquía visual, no un ícono perdido.
- Separación Empezar/mic: `SizedBox(width: 12)` en un `Row`, ambos centrados horizontalmente bajo el input.

---

## 2. Botón de voz — interacción y estados

**Modelo de interacción: tap-to-toggle, no press-and-hold.** Con press-and-hold (tipo WhatsApp) cualquier temblor de mano o que el usuario levante el dedo antes de terminar de hablar corta la grabación a mitad de frase — mal en un input que puede ser una pregunta larga. Tap para empezar, tap de nuevo para terminar (o corte automático por silencio/límite, ver abajo) es más tolerante y más accesible.

**Salvaguardas de duración** (para que nunca quede "grabando" indefinidamente si el usuario se olvida):
- Corte automático por silencio: si el motor de STT lo soporta nativamente (silencio de ~2-3s sin habla detectada → termina solo), usarlo — es lo que ya hace `speech_to_text` por default.
- Límite duro: 30s de grabación máxima, corta solo y pasa a "Procesando" con lo que se haya capturado hasta ahí. Evita una grabación colgada por un bug del plugin o un silencio que el motor no detectó.

### Estados

```
┌──────┐   tap                ┌──────┐   habla + silencio/          ┌──────────┐
│  🎤  │ ───────────────────► │  ⏹  │   límite 30s / tap de nuevo   │   ⏳     │
│ idle │                      │ rec  │ ─────────────────────────────► │processing│
└──────┘                      └──────┘                                └──────────┘
   ▲                             │                                        │
   │                             │ permiso de mic denegado                │
   │                             ▼ (falla al iniciar, no llega a grabar)  │
   │                          ┌──────────┐                                │
   │  tap "Abrir ajustes"     │  error   │ ◄──────────────────────────────┤
   │  o tap de nuevo (reintenta) permiso │   sin texto reconocido /       │
   └──────────────────────────│ denegado │   error del motor STT          │
                               └──────────┘                                │
                                                                            │ texto reconocido no vacío
                                                                            ▼
                                                                  auto-fill del input pill
                                                                  + auto-submit (mismo submit()
                                                                  que Empezar) → nuevo chat
```

**Detalle visual por estado:**

1. **Idle**: círculo `surface` (blanco), ícono `Icons.mic` en `colorScheme.primary` — mismo verde que Empezar, para que se lea como par de acciones equivalentes (texto vs. voz).

2. **Recording**: el círculo cambia de fondo a rojo (`Colors.red` o `colorScheme.error` si el rojo de M3 no choca con el resto de la paleta — usar `error` para no introducir un color fuera del scheme), ícono cambia a `Icons.stop` (cuadrado/stop, no el mismo mic) en blanco. Agregar un **pulso sutil** alrededor del círculo (un segundo círculo semi-transparente que crece y se desvanece en loop, `AnimationController` simple) — comunica "está vivo/escuchando" sin ser un spinner genérico de carga (mismo criterio que usamos para "Esperando selección..." del picker interactive: un spinner de "processing" es engañoso acá, esto no está cargando, está escuchando). Debajo del botón, un timer chico (`0:03`, `0:04`...) para que el usuario sepa cuánto lleva grabando y no se sienta perdido cerca del límite de 30s.
   - **Si el motor da resultados parciales** (`speech_to_text` los da por default): mostrar el texto reconocido en vivo dentro del input pill mientras se graba, reemplazando el hint — feedback inmediato de que "está entendiendo", patrón esperado (Google Assistant, Siri). Si el motor no da parciales, el input se queda con el hint hasta que termine — no inventar un placeholder falso tipo "Escuchando..." en el input (mejor dejar el hint real y que el timer/pulso comuniquen que está grabando).

3. **Processing** (grabación terminó, esperando el resultado final de transcripción — normalmente breve, <1-2s, pero variable si el motor hace la transcripción en la nube en vez de on-device): círculo vuelve a `surface`/blanco, ícono reemplazado por un `CircularProgressIndicator` chico (spinner sí corresponde acá — esto sí es "cargando" un resultado). Botón deshabilitado (no-tap) durante este estado. Sin límite largo explícito — si el plugin nunca resuelve, es un bug de plataforma, no algo que la UX deba diseñar un timeout para v1 (a diferencia del picker SAF, esto no depende de un humano en otro dispositivo, es una llamada local).

4. **Resultado OK → auto-submit**: si el texto reconocido no está vacío, se auto-completa el input pill con ese texto (ya visible si hubo parciales; si no, aparece de golpe) y se dispara el mismo `submit()` que ya usa "Empezar" — mismo camino a `_startNewChat(initialMessage: text)`, cero código nuevo de envío. **No hay pantalla de confirmación intermedia** — el usuario ve el texto aparecer en el input y el chat abrirse, igual que si lo hubiera tipeado y tocado Empezar. Es la decisión que pide el pedido original ("el texto reconocido se manda como mensaje"); el trade-off consciente es que no hay chance de corregir un error de transcripción antes de mandar — aceptable acá porque es el primer mensaje de un chat nuevo (bajo riesgo, se puede corregir con el siguiente mensaje) y porque frenar para pedir confirmación en cada uso de voz es la fricción que la feature busca evitar. Si esto no cierra en la práctica al probarlo, el ajuste mínimo es demorar el auto-submit ~600ms después de completar el input (ventana chica para que el usuario cancele/edite) — lo dejo anotado pero no lo hago default.

5. **Error**: dos causas distintas, tratamiento distinto:
   - **Permiso de micrófono denegado**: círculo con ícono `Icons.mic_off`, tinte de error (`colorScheme.error`/rojo apagado, no el rojo intenso de "recording" — para no confundir ambos estados). Debajo, texto fijo corto: "Micrófono deshabilitado" con un botón/enlace "Abrir ajustes" que lleva a la configuración de la app (permiso del SO) — no alcanza con solo mostrar el error, ya que sin ir a ajustes el usuario queda trabado para siempre en este estado.
   - **Sin habla detectada / error del motor** (silencio total, ruido, fallo transitorio del engine): mismo ícono `mic_off` pero texto distinto y transitorio: "No se entendió, probá de nuevo" — desaparece solo a los ~2-3s y vuelve a **idle**, sin necesitar acción del usuario (a diferencia del permiso denegado, que es persistente hasta que el usuario actúe).
   - Ninguno de los dos error-states bloquea el resto de la pantalla — "Empezar" con texto tipeado sigue funcionando siempre como fallback.

### Accesibilidad / afordancia

- `Semantics`/`tooltip` en el botón: "Grabar mensaje de voz" en idle, "Detener grabación" en recording — un lector de pantalla no tiene forma de inferir el estado solo por el color.
- Tamaño mínimo de touch target 48x48 (estándar Material) aunque el ícono visual sea más chico — ya standard en `IconButton`, solo confirmar que no se achica por compartir fila con "Empezar".

---

## 3. Qué no cambia / fuera de alcance

- TTS de salida: explícitamente fuera de este pedido (usuario lo aclaró) — el flujo es solo voz→texto→mensaje, la respuesta del modelo se sigue leyendo, no se lee en voz alta.
- La pantalla de Chat list con sesiones existentes (`build()`, cuando `rows.isNotEmpty`) no cambia — este rediseño es solo para el estado vacío/composer inicial.
- Nada de esto toca protocolo/gateway — todo es client-side (permiso de mic + plugin STT + mismo `submit()` que ya existe). Frontend puede implementarlo sin coordinar con Backend/Architect.

---

## 4. Preguntas abiertas para Frontend (no bloquean empezar)

1. ¿Confirmar `speech_to_text` u otro paquete? Si el elegido no da resultados parciales, ajusto §2.2 (sin texto en vivo durante recording, solo timer+pulso) — avisame cuál para cerrar la referencia exacta en el doc.
2. Confirmar si Android/iOS ya tienen los permisos de mic declarados en `AndroidManifest.xml`/`Info.plist` — si no, es un paso de implementación aparte, no de diseño, pero afecta cuándo puede probarse en dispositivo real.

---

## 5. Ajuste post-implementación (2026-09-04): mic debajo de Empezar + más grande, reuso en Chat individual

Pedido del usuario después de probar la v1 en dispositivo real (adb reverse, Samsung físico): mover el mic de al lado de "Empezar" a **debajo**, agrandarlo (~20% de la pantalla, para apuntar más fácil con el dedo), y agregar el mismo botón en la pantalla de chat individual. Es refinamiento de layout/tamaño/superficie — la lógica de estados (§2) no cambia en ninguna de las dos superficies.

### 5.1 Home (`empty_composer.dart`) — layout nuevo

Código actual (`empty_composer.dart:187-195`): `Row` con `ElevatedButton.icon` (Empezar) + `SizedBox(width:12)` + `_buildMicButton` de 48dp fijo, lado a lado.

Cambia a:

```
        Icon (árbol)
        Input pill
        Empezar (sin cambios de estilo)
        [ espacio ]
        ┌─────────────┐
        │             │
        │     🎤      │   ← círculo, diámetro = 20% del ancho de pantalla
        │             │
        └─────────────┘
        (timer / error text, si aplica)
```

- **Reemplazar el `Row` por un `Column`**: `Empezar` centrado arriba (`mainAxisSize: MainAxisSize.min`, ya está centrado por el `Center` padre), `SizedBox(height: 16)`, mic centrado debajo.
- **Tamaño**: `MediaQuery.of(context).size.width * 0.2` como diámetro del círculo — uso el ancho de pantalla porque es la referencia más natural para "tamaño de la pantalla" en un botón circular en layout portrait (con la altura daría un número raro por el aspect ratio). En un teléfono típico (~360-420dp de ancho) da ~72-84dp — sensiblemente más grande que los 48dp actuales, coincide con el pedido ("dedo grande, apuntar más fácil"). **Clamp sugerido**: `.clamp(64.0, 96.0)` para no descontrolarse en tablets/pantallas muy anchas (a 20% literal en un ancho de 800dp daría 160dp, desproporcionado) — no es parte literal del pedido pero evita un bug visual obvio en el único otro form factor donde esta pantalla podría verse.
- El ícono interno (`Icons.mic`/`Icons.stop`/`Icons.mic_off`) escala con el círculo — hoy está fijo en `size: 22` (línea 254/282/300 de `_buildMicButton`): pasa a algo proporcional, ej. `size: micDiameter * 0.35`, para que no quede un ícono chico perdido en un círculo grande.
- El pulso de "recording" (el círculo semi-transparente que crece, `_pulseController`) ya está expresado en términos de `size * (1 + t * 0.8)` — al pasar `size` como parámetro en vez de la constante `48.0`, el efecto escala solo, sin tocar esa lógica.
- Nada más cambia: mismo `_VoiceState`, mismo `_onMicTap`, mismo timer/error text debajo.

### 5.2 Chat individual (`chat_screen.dart`) — mismo botón, superficie distinta

El composer de esta pantalla (`_buildInput`, `chat_screen.dart:759-794`) es una barra angosta al pie: `Row` con `Expanded(TextField)` + `IconButton(send)` dentro de un `SafeArea`/`Padding(8)`. **Acá el mic NO va a 20% de pantalla** — en una barra de ~56dp de alto, un botón de 70-90dp de diámetro rompe el layout, se sale de la barra o la infla a un tamaño que no tiene sentido en una superficie de trabajo (vs. la home, que es una pantalla dedicada solo a arrancar). Mismo componente, tamaño adaptado al contexto — es la superficie la que cambia, no el diseño del botón en sí.

- **Tamaño**: 48dp fijo, igual al `IconButton` de enviar que ya existe en esa fila — mismo peso visual que sus vecinos, no un elemento que grita más que el resto de la barra.
- **Posición**: entre el `TextField` y el `IconButton` de enviar — orden de lectura "escribí o hablá, después mandá": `Expanded(TextField)` → mic (48dp) → send (48dp). No reemplaza al send ni condiciona su visibilidad (no es "mic si vacío, send si hay texto" tipo WhatsApp) — conviven siempre, son dos formas de completar el mismo input.
- **Auto-submit**: mismo comportamiento que en home — al completarse el reconocimiento, el texto llena `_inputController` y dispara `_send()` (el mismo método que ya usa el `IconButton` de enviar). Cero lógica de envío nueva en esta pantalla tampoco.
- **Respeta el bloqueo de composer existente**: `_buildInput` ya deshabilita el `TextField` y el `IconButton` de enviar mientras `_thinking` es `true` (regla confirmada por Architect — ver `mobile-chat-ux-flows.md` §5.2, ningún turno nuevo mientras uno está en vuelo). El mic tiene que respetar la misma regla: deshabilitado (no-tap, mismo tratamiento visual atenuado que ya tiene el send cuando `blocked`) durante un turno en curso — grabar y auto-mandar un mensaje mientras el modelo todavía está respondiendo el anterior es exactamente la carrera de `chat.send` que esa regla existe para evitar.
- **Feedback recortado por espacio** — la barra no tiene una línea libre debajo como la home para mostrar el timer o el texto de error permanente:
  - Timer de grabación (`0:03`...): **se omite** en esta superficie. El pulso rojo animado del ícono ya comunica "está grabando"; agregar texto ahí exigiría reservar una segunda línea permanente en una barra que hoy es de una sola línea, cambiando el layout del composer para todos los estados (no solo mientras se graba) — no vale la pena por un dato secundario.
  - Texto en vivo (resultados parciales): sigue funcionando igual — se ve directo en el `TextField`, que ya está ahí.
  - Error de permiso denegado / no-se-entendió: en vez del texto fijo debajo (no hay dónde ponerlo sin reflow), usar un `SnackBar` transitorio con el mismo mensaje ("Micrófono deshabilitado" con acción "Abrir ajustes" / "No se entendió, probá de nuevo") — mismo contenido, canal de entrega distinto porque la superficie no tiene el espacio dedicado que sí tiene la home.

### 5.3 Nota de implementación (no bloqueante, sugerencia de Frontend)

El estado (`_VoiceState`, `_onMicTap`, timers, `_speech`) está hoy encapsulado dentro de `_EmptyComposerState`, privado a `empty_composer.dart`. Para reusarlo en `chat_screen.dart` sin duplicar la máquina de estados completa, tiene sentido extraer un widget compartido (ej. `VoiceMicButton` en `lib/chat/voice_mic_button.dart`) parametrizado por `size` (48 en chat, `screenWidth*0.2` clamped en home) y `onRecognized(String text)` (home: setea el input y llama `_submit()`; chat: setea `_inputController` y llama `_send()`). **La feedback durante `recording`/`processing` ya no depende de la superficie — ver §6.2**, así que el flag `showInlineFeedback` que proponía acá queda obsoleto: ambas superficies delegan ese estado al mismo sheet full-screen, sin variante compacta.

---

## 6. Reconciliación con el diseño de referencia (Claude Design) — 2026-09-04

Al construir el prototipo clickeable en Claude Design (`notes/yggdrasil-mobile/...` — ver mensaje a Frontend / artifact publicado) usé como base un diseño de referencia del usuario que ya resuelve la entrada de voz con un patrón distinto y mejor: un ícono que reemplaza al de enviar dentro del mismo input pill (no un botón aparte) que abre un **sheet full-screen "Escuchando"** — waveform de 7 barras animadas + texto reconocido creciendo en vivo, en vez de un botón que pulsa con un timer numérico debajo.

Placement/trigger (botón dedicado, grande en home, 48dp en chat, tap-to-toggle) **se mantiene tal cual §1/§5.1/§5.2** — fue un pedido explícito de accesibilidad del usuario, no lo piso. Lo que cambia es **qué pasa visualmente después de tocarlo**, en las dos superficies:

### 6.1 Qué se reemplaza

- ❌ Pulso rojo alrededor del botón + timer `0:03` en texto debajo (§2.2/§5.1 original).
- ❌ Tratamiento distinto por superficie: en home, timer+error visibles; en chat, "recortado por espacio" (sin timer, errores por `SnackBar`) — ver §5.2 original, punto "Feedback recortado por espacio".
- ✅ **Un único sheet full-screen** (bottom sheet oscuro con blur de fondo, card redondeada subiendo desde abajo), igual en home y en chat — ya no hace falta la variante "recortada" para chat, porque el sheet no vive dentro de la barra angosta del composer: se superpone a toda la pantalla sea cual sea la superficie que lo disparó. Esto **simplifica** §5.2: ya no hay compromiso por espacio que documentar ahí.

### 6.2 Máquina de estados del sheet (reemplaza la de §2/§5.1 para todo lo posterior al tap)

```
tap en el botón dedicado (home 20%w o chat 48dp — sin cambios)
      │
      ▼
┌─────────────────────────────────────┐
│         ESCUCHANDO                    │  ← sheet sube desde abajo, fondo
│    ▌▌▌▌▌▌▌  (7 barras, animadas)     │     oscurecido+blur detrás
│                                         │
│   "qué debería plantar en un..."       │  ← texto reconocido en vivo (si
│                                         │     el motor da parciales; si no,
│                                         │     queda vacío hasta el final)
│                                         │
│           [ Cancelar ]                 │  ← única acción, siempre visible
└─────────────────────────────────────┘
      │
      │ silencio detectado / límite 30s / tap de nuevo en el botón
      ▼
┌─────────────────────────────────────┐
│         TRANSCRIBIENDO                │  ← mismo sheet, cambia el contenido
│              ⏳ (spinner)              │     interno: barras → spinner
│           [ Cancelar ]                 │
└─────────────────────────────────────┘
      │
      ├── texto no vacío → sheet se cierra + auto-submit (mismo submit()/_send()
      │   de siempre) — SIN paso de confirmación intermedio, igual que la
      │   decisión original de §2.4
      │
      └── texto vacío / error del motor → el sheet queda abierto y cambia a:
┌─────────────────────────────────────┐
│    "No se entendió, probá de nuevo"   │  ← reemplaza el spinner, mismo sheet
│           [ Cancelar ]                 │     se auto-cierra solo a los ~2-3s
└─────────────────────────────────────┘
```

- **Permiso de micrófono denegado**: no abre el sheet — el botón dedicado pasa directo a su estado `errorPermission` (`Icons.mic_off` + texto "Micrófono deshabilitado" + "Abrir ajustes", como ya estaba en §2.5) porque ahí todavía no hay nada que escuchar. Esto no cambia.
- **Cancelar** dentro del sheet: cierra el sheet inmediatamente sin submit, en cualquiera de sus dos sub-estados (Escuchando o Transcribiendo) — mismo criterio de "sin confirmación extra" que ya estaba decidido.
- **Timer numérico**: se elimina. Las 7 barras animadas + el texto en vivo ya comunican "está pasando algo" mejor que un contador de segundos — el límite duro de 30s sigue existiendo como salvaguarda (§2, "Salvaguardas de duración"), simplemente ya no se muestra en pantalla.
- **En chat** (`chat_screen.dart`): el sheet se dispara igual, se superpone a toda la pantalla (no solo al área del composer) — el `_buildInput` bloqueado durante `_thinking` sigue aplicando igual que antes (§5.2 original), el sheet es ortogonal a esa regla.

Esto es lo que ya está construido en el prototipo Claude Design (artboard `Main.dc.html`, sheet `voiceSheet`) — Frontend puede tomarlo como referencia visual 1:1 (colores, timing de las barras, radios) al portar esto a Flutter.
