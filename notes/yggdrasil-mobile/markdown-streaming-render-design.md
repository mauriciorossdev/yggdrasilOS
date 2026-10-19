# Diseño técnico: renderizar markdown en respuestas del modelo (streaming)

Estado: **diseño, sin implementar** — a pedido explícito del usuario. No toco código.
Basado en: lectura del código actual (`lib/chat/chat_screen.dart`, `pubspec.yaml`) — sin dependencia de UX, que está diseñando en paralelo qué elementos priorizar y su look en tema oscuro; este doc cubre la ingeniería del streaming/parseo, no el visual.
Fecha: 2026-09-06.

## 0. Punto de partida (confirmado en código)

- `chat_screen.dart:34` — `_Item` tiene `bool streaming`, default `false` (línea 46).
- `chat_screen.dart:190-204` (`_onDelta`) — cada chunk de `chat.delta` hace `reply.text += text` dentro de un `setState` sincrónico, sin debounce ni buffer. Puede dispararse muchas veces por segundo (depende de cómo trocee el proveedor su streaming, no algo que este cliente controle).
- `chat_screen.dart:206-218` (`_onFinal`) — pone `streaming = false` cuando llega `chat.final`, texto ya completo y estable.
- `chat_screen.dart:640-656` — el render actual: un único `RichText`/`TextSpan` con `item.text` crudo, más un `WidgetSpan` con `_BlinkingCaret` al final si `item.streaming`. Cero parseo de markdown hoy.
- `pubspec.yaml:22-44` — confirmado, no hay `flutter_markdown` ni ningún parser de markdown ni highlighter de código en las dependencias actuales.

## 1. Approach: parseo en vivo (throttled) + fallback a texto plano en la cola inestable — no "todo o nada"

Evalué las tres opciones que planteó el pedido, y la respuesta no es ninguna de las tres puras — es una combinación que ya usan los chats de LLM de referencia (ChatGPT/Claude web):

| Opción | Se ve markdown en vivo | Riesgo de parpadeo | Costo CPU por chunk |
|---|---|---|---|
| (a) Parsear el string completo en cada rebuild, sin mitigación | Sí | Alto — cualquier marcador a medio cerrar se rompe visualmente en cada chunk | Alto si no hay throttle |
| (b) Plano mientras `streaming`, parsear recién en `_onFinal` | No hasta que termina | Ninguno | Mínimo durante streaming, un parseo grande al final |
| (c) **Parseo en vivo + throttle + heurística de "cola insegura" (recomendado)** | Sí, con ~60ms de latencia | Bajo — la cola insegura se muestra como texto plano hasta que cierra | Acotado por el throttle, ver §3 |

**Recomendación: (c).** (b) es la opción más simple y queda anotada como fallback de v1 más barato si se prefiere entregar algo primero e iterar — con (b) no hace falta nada de lo que sigue en §2/§3, solo envolver el `RichText` actual en un `if (item.streaming) ... else MarkdownBody(...)`. Pero (b) tiene un costo de UX real que vale la pena nombrar: un mensaje largo (varios segundos de streaming) se lee como una pared de texto plano — sin negritas, sin bullets, sin bloques de código con estilo — que recién "salta" a su formato final de golpe cuando el streaming termina, un cambio de layout brusco justo en el peor momento (cuando el usuario ya está leyendo). (c) evita eso a cambio de la complejidad de §2/§3, que de todos modos hay que resolver alguna vez si el objetivo final es que el chat se sienta como los de referencia.

### Librería

- **Parseo: `package:markdown`** (paquete oficial de dart-lang, sin dependencia de Flutter, solo AST) — riesgo bajo, mantenimiento activo por el propio equipo de Dart, no ligado al ciclo de vida de ningún widget de terceros. Es la base independientemente de qué capa de renderizado se elija.
- **Renderizado (AST → widgets)**: **no cierro un paquete específico sin verificar su estado actual en pub.dev al momento de implementar** — `flutter_markdown` (el paquete oficial del equipo de Flutter) fue archivado, así que no lo recomiendo para un proyecto nuevo. El candidato más directo es `flutter_markdown_plus` (continuación mantenida por la comunidad tras el archivado) — pero antes de agregarlo a `pubspec.yaml` hay que confirmar: publicado recientemente, sin issues críticos abiertos, y que exponga un builder configurable para bloques de código (necesario para §4) y algo tipo `MarkdownStyleSheet` para que UX pueda inyectar sus propios colores/tipografía sin pelear contra un tema por default. Mismo criterio de este proyecto de no asumir que un paquete/comportamiento externo sigue vigente sin confirmarlo (`external-actions-and-connectors-analysis.md` §6, verificación en hardware real antes de cerrar).
- Nota de seguridad menor, no bloqueante: `package:markdown` puede interpretar HTML embebido según el spec de CommonMark — no hay ningún WebView en esta app así que no hay riesgo de ejecución, pero conviene confirmar que el renderer elegido trata un `<tag>` suelto que el modelo escriba como texto literal escapado, no como algo especial — un chequeo de una línea al integrar, no una sección aparte.

## 2. Heurística para no romper visualmente un marcador a medio cerrar

No hace falta un parser "streaming-aware" completo (mucha superficie para tablas/listas anidadas/links, alto riesgo de bugs sutiles para un proyecto personal). El truco que ya usan las apps de referencia es más barato: **separar el string en un "prefijo seguro" (se parsea y renderiza como markdown) y una "cola insegura" (se muestra como texto plano, sin intentar interpretarla) hasta que deja de estar a medio cerrar.**

```dart
/// Escanea desde el final del string buscando marcadores abiertos sin
/// cerrar. Devuelve el índice donde cortar: todo antes es seguro de
/// parsear, todo después se muestra como texto plano hasta que cierre.
int findSafeMarkdownBoundary(String text) {
  // 1. Punto de partida: el último salto de párrafo (\n\n) o el principio
  //    del string si no hay ninguno — nunca corta a mitad de un bloque ya
  //    completo, así el parser real solo repite trabajo sobre el último
  //    párrafo en curso, no sobre todo el mensaje en cada llamada.
  // 2. Desde ahí, contar (no parsear completo, solo contar apariciones):
  //    - "**" — si la cuenta es impar, el bold no cerró: cortar antes del
  //      último "**".
  //    - "*"/"_" simples usados como itálica (excluyendo los ya contados
  //      como parte de "**") — mismo criterio, impar → cortar antes.
  //    - "[" sin un "](...)" completo después — link/imagen a medio
  //      escribir → cortar antes del "[".
  //    Cada chequeo, si dispara, mueve el corte más atrás (nunca adelante).
  // 3. NO se trata como inseguro un "```" sin cerrar — un bloque de código
  //    abierto se renderiza igual, creciendo línea a línea, mismo
  //    comportamiento visual que ChatGPT/Claude mientras el modelo sigue
  //    escribiendo el bloque. Es información útil verla en vivo, y el
  //    propio parser ya lo trata como "todo lo que sigue es código" de
  //    forma estable (no flashea).
}
```

- Esta función es barata (recorrido de string, no un parseo real) — puede correr en cada chunk sin problema, independientemente del throttle de §3 (que protege el parseo real, no este escaneo).
- **Tablas — caso que queda afuera a propósito, no es un bug**: una tabla no es reconocible como tabla hasta que llega la fila separadora (`---|---`) después de los headers — mientras tanto, cualquier parser de markdown estándar (incluido `package:markdown`) simplemente no la reconoce y muestra la fila de headers como texto plano con los `|` literales. En el instante en que llega el separador, ese párrafo se re-parsea completo y "salta" a tabla. Es un único parpadeo puntual, inherente a cómo está definida la sintaxis de tablas en markdown (no hay forma de saber antes que va a ser tabla) — no vale la pena construir una heurística para ocultarlo, se anota acá para que no se lea como un bug no contemplado.
- La cola insegura se renderiza con el mismo `RichText`/`TextSpan` que ya existe hoy (`chat_screen.dart:640-656`) — **no se descarta ese código, se reusa tal cual, solo alimentado con la cola en vez del texto completo.** El caret parpadeante sigue pegado al final de esa cola, así que visualmente sigue marcando la punta real de lo que está llegando, no el final de un bloque ya renderizado.

## 3. Performance — throttle explícito, no dejar que Frontend lo improvise

Sin mitigación, cada `chat.delta` dispararía: el escaneo de §2 (barato) + un parseo markdown real del prefijo seguro (AST + construcción de widgets, no barato) + un `setState` a nivel de toda la pantalla. Para una respuesta larga con streaming rápido esto puede acumular jank real en hardware de gama media (el mismo Samsung que este proyecto ya usa como referencia de verificación).

**Mecanismo: throttle por tiempo con `Timer`, no un debounce que espere silencio** — un debounce clásico (esperar a que paren de llegar chunks) retrasaría el primer render hasta que el modelo hiciera una pausa, que puede no pasar nunca en un stream continuo. Lo que hace falta es limitar la *frecuencia* de rebuild, no esperar una pausa:

```dart
Timer? _renderThrottle;
static const _throttleInterval = Duration(milliseconds: 60); // ~16 renders/seg, tope

void _onDelta(String text) {
  if (text.isEmpty) return;
  _thinking = false;
  final reply = _streamingReply;
  if (reply == null) {
    // primer chunk del mensaje: setState inmediato, sin throttle — que la
    // respuesta no se sienta "tardía" al arrancar.
    setState(() { /* crear item, igual que hoy */ });
  } else {
    reply.text += text; // fuera de setState — no dispara rebuild solo
    if (_renderThrottle?.isActive ?? false) return;
    _renderThrottle = Timer(_throttleInterval, () {
      if (mounted) setState(() {}); // el próximo build lee item.text ya actualizado
    });
  }
  _scrollToBottom();
}

void _onFinal(String text) {
  _renderThrottle?.cancel(); // no dejar un tick pendiente pisando el final
  setState(() {
    // igual que hoy — reply.streaming = false, parseo final se hace
    // sobre el texto completo y estable, sin heurística de §2 (ya no
    // hace falta, no hay cola insegura en un mensaje terminado).
  });
}
```

- `60ms` es punto de partida razonable (~16 actualizaciones/seg) — a ojo humano leyendo texto que aparece, esto ya se percibe fluido; no hace falta acercarse a 60fps para algo que es aparición de texto, no animación. Ajustable si Frontend mide jank real en el Samsung con este valor.
- `_onFinal` cancela el timer pendiente y fuerza un `setState` propio — garantiza que la cola de texto que quedó sin "flushear" por el throttle se pinte completa e inmediata al terminar, sin depender de que el próximo tick del timer llegue a tiempo.
- **Extra barato, no bloqueante**: memoizar en el propio `_Item` el último `(longitud de texto, prefijo seguro, widget ya construido)` usado para parsear, y saltear el re-parseo si nada cambió desde la última vez — cubre el caso de un rebuild disparado por otra razón (scroll, otro mensaje cambiando) que de otro modo re-parsearía un mensaje que no se movió.
- **Si el throttle + memoización no alcanzan** (a confirmar perfilando en el dispositivo real, no asumido acá): el siguiente escalón es sacar `item.text` del `setState` a nivel de pantalla y pasarlo a un `ValueNotifier`/`ChangeNotifier` scopeado solo al tile del mensaje en streaming, para que el rebuild no vuelva a tocar el resto de la lista en absoluto. Lo dejo anotado como escalón siguiente, no como parte obligatoria de este diseño — no vale la pena esa refactor si el throttle simple ya resuelve el jank real.

## 4. Code blocks — monospace plano en v1, syntax highlighting queda como mejora aparte

No hace falta agregar un highlighter (`flutter_highlight`/`highlight`/similar) para v1 — recomiendo bloque monoespaciado con fondo diferenciado (container + `Text` con fuente monoespaciada), sin colorear por lenguaje, por estas razones:

- Es una dependencia y una decisión de paleta (colores por token — keyword/string/comment — en tema oscuro) que le corresponde a UX, no algo que yo deba pre-cerrar en un doc de ingeniería de streaming.
- Cualquier paquete de renderizado de markdown razonable (§1) expone un builder/callback para bloques de código pluggable — significa que sumar highlighting después es un cambio contenido a esa única pieza, no una reapertura de todo lo diseñado acá (parseo/throttle/heurística de cola insegura quedan exactamente igual).
- El modelo normalmente sí manda el lenguaje en el info-string del fence (```` ```dart ````) cuando lo sabe, así que la infraestructura para highlighting futuro (saber qué lenguaje pintar) ya viene gratis del parseo — no hay que diseñar nada extra para dejar la puerta abierta, solo no tirar ese dato al piso cuando se arme el bloque plano de v1.

## 5. Qué queda para UX (no lo resuelvo acá)

- Colores/tipografía de cada elemento (headers, bold, listas, blockquotes, tabla, bloque de código) en tema oscuro — se inyectan vía la style-sheet del paquete elegido en §1, el seam de integración es ese objeto de estilo, no algo que este doc defina.
- Si el bloque de código en v1 (monoespaciado plano, §4) necesita algún tratamiento visual mínimo (fondo, borde, botón de copiar) — es diseño visual, no ingeniería de streaming.
- Tratamiento exacto de la cola insegura (§2) mientras se muestra como texto plano — ¿mismo estilo que el texto normal (mi recomendación, para que no "salte" de estilo cuando el prefijo la absorbe) o algo sutilmente distinto (ej. opacidad reducida) para señalar "esto todavía se está formateando"? Lo dejo como pregunta abierta para UX, la mecánica de corte (§2) funciona igual sea cual sea la respuesta.

## 6. Resumen de decisiones

1. **Approach**: parseo en vivo con throttle + heurística de cola insegura (opción c) — no plano-hasta-el-final ni parseo sin mitigación. (b) queda anotado como fallback más barato si se prefiere iterar.
2. **Librería**: `package:markdown` para el parseo (AST), fijo — capa de renderizado a widgets se confirma en pub.dev al implementar (candidato: `flutter_markdown_plus`), no la cierro sin verificar mantenimiento vigente.
3. **Heurística anti-flicker**: `findSafeMarkdownBoundary` — corta el string en prefijo-seguro/cola-insegura contando `**`/`*`/`_`/`[...]` sin cerrar desde el último párrafo completo; bloques de código abiertos NO se tratan como inseguros (crecen en vivo, ya estable); tablas a medio armar quedan como parpadeo puntual aceptado, no una heurística más.
4. **Performance**: `Timer` de throttle (~60ms, ajustable) en vez de debounce-por-silencio, primer chunk sin throttle, flush forzado en `_onFinal`, memoización opcional por-item, y `ValueNotifier` scopeado por tile como escalón siguiente solo si el throttle no alcanza en el dispositivo real.
5. **Code blocks**: monoespaciado plano en v1, sin highlighting — la puerta para sumarlo después queda abierta gratis vía el builder pluggable del paquete de renderizado y el info-string de lenguaje que el parseo ya captura.
6. **Reuso real de lo existente**: el `RichText`/`TextSpan`/`_BlinkingCaret` de `chat_screen.dart:640-656` no se tira — pasa a renderizar solo la cola insegura (§2), y desaparece del todo (queda solo el bloque markdown) una vez que `streaming` es `false`.

---
Generado con Claude Code — sesión: https://claude.ai/code/session_01WYAisFZiCxEX1YPyCKM7P7
