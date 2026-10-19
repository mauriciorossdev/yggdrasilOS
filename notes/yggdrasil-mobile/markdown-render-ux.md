# UX: qué markdown priorizar en las respuestas del modelo y cómo se ve en tema oscuro

Estado: **propuesta de flujo/visual, sin implementar.** Complementa `markdown-streaming-render-design.md` (Architect, ingeniería del streaming/parseo, cerrado) — este doc no reabre esa parte, define qué elementos priorizar y su estilo concreto sobre la paleta actual. No toco código.
Basado en: `markdown-streaming-render-design.md` (mecanismo de streaming, heurística de "cola insegura", decisión de code blocks planos en v1) + lectura de `chat_screen.dart:600-804` (render actual del mensaje del assistant, `_pill`, approval card) + `theme/ygg_theme.dart:1-27` (tokens `YggColors`) + `pubspec.yaml:43` (`url_launcher` ya es dependencia, confirmado — los links tappables no necesitan sumar nada nuevo).

---

## 0. Punto de partida

Hoy el mensaje del assistant es un único `RichText`/`TextSpan` (`chat_screen.dart:640-656`): `fontWeight: w300`, `fontSize: 15.5`, `height: 1.6`, color `YggColors.text` (`#F4EFE6`, casi blanco) sobre fondo `YggColors.bg` (`#003833`, verde muy oscuro) — sin card ni container alrededor, el texto flota directo sobre el fondo de la pantalla. Es la superficie donde va a vivir todo lo de este doc, salvo tablas y code blocks que sí necesitan su propio container (ver §2/§3).

Paleta disponible (`ygg_theme.dart:12-26`): `accent` `#C9A54E` (dorado, ya usado para el risk-badge y probablemente botones/interactivos), `text`/`textMuted`/`textFaint` (blanco hueso en distintas opacidades), `errorRed` `#C1633B`, `hairline`/`hairlineStrong` (blanco al 12%/20%, usado como borde sutil en la card de approval, `chat_screen.dart:766`), `cardFillHigh`/`cardFillHighest` (blanco al 7%/9%, fill de containers). El approval card (`chat_screen.dart:763-802`) ya usa monospace (`fontFamily: 'monospace'`) para nombre de tool y JSON de args — es el precedente visual más cercano a "código" que ya existe en la app, lo reuso como base para §3.

---

## 1. Prioridad de implementación

| Orden | Elemento | Por qué acá |
|---|---|---|
| 1 | **Bold / itálica** | Más frecuente con diferencia, más barato — el paquete de renderizado (`markdown-streaming-render-design.md` §1) los da gratis vía `TextStyle`, sin layout nuevo que diseñar. |
| 1 | **Listas** (bullet/numeradas, un nivel) | Igual de frecuentes que bold/itálica en respuestas explicativas — indentación + marcador, sin necesitar un container nuevo. Anidamiento (sub-listas) puede quedar de mínima (indent extra, sin diseño especial) — no vale la pena una regla propia para un caso que aparece poco. |
| 1 | **Links** | Mismo costo que bold (un `TextStyle` con color+underline) — la única parte no-trivial es que sean tappables (`url_launcher`, ya en `pubspec.yaml:43`, cero dependencia nueva). |
| 2 | **Headers** (`#`/`##`/`###`) | No lo pidió el pedido original pero el modelo los genera seguido en respuestas estructuradas — mismo costo que bold (tamaño+peso), lo sumo para no dejar un hueco. |
| 2 | **Código inline** (`` `texto` ``) | Un `TextSpan` con fill + monospace, sin container propio — barato, alta frecuencia cuando el modelo menciona nombres de variables/comandos sueltos. |
| 3 | **Code blocks** (` ``` `) | Necesita container propio (fondo diferenciado, scroll horizontal) — más trabajo que lo de arriba, pero unidimensional (un bloque, sin estructura interna que decidir). Ya resuelto sin highlighting en v1 por Architect (`markdown-streaming-render-design.md` §4) — acá solo defino el estilo. |
| 4 | **Tablas** | Última a propósito, coincide con el criterio del pedido original: es lo más complejo en pantalla angosta (columnas, alineación, decisión de layout completa — ver §2) y lo menos frecuente de los seis. Además Architect ya marcó que el parpadeo de "aparece como texto con `\|` literales hasta que llega la fila separadora" es inherente a la sintaxis (`markdown-streaming-render-design.md` §2) — no es una prioridad de pulido temprano. |

**Blockquotes** (`>`) no estaban en el pedido y los dejo fuera de esta prioridad explícitamente — aparecen poco en respuestas de chat (son más de citar texto ajeno) y un estilo mínimo (barra vertical `accent` a la izquierda + texto `textMuted` en itálica) alcanza el día que se necesiten, no ameritan diseño dedicado ahora.

---

## 2. Tablas — scroll horizontal, no tarjetas apiladas

**Decisión: scroll horizontal dentro de un container acotado al ancho de la burbuja, no layout de tarjetas apiladas.** Razones:

- **Consistencia de interacción**: los code blocks (§3) ya van a usar scroll horizontal para líneas largas — "el contenido ancho se desliza al costado, dentro de su propio recuadro" pasa a ser una regla única que el usuario aprende una vez y aplica a dos elementos, en vez de dos comportamientos distintos (tabla se apila, código se desliza) para el mismo problema de fondo (contenido más ancho que la pantalla).
- **Costo de implementación real**: el paquete de renderizado markdown (`markdown-streaming-render-design.md` §1) va a dar un `Table`/`DataTable` de fábrica vía su builder pluggable — envolverlo en un `SingleChildScrollView(scrollDirection: Axis.horizontal)` es un cambio contenido. Un layout de tarjetas apiladas (cada fila como lista vertical clave:valor) es render 100% custom, no algo que el paquete dé como opción — mucho más trabajo para una decisión que no cambia qué información llega, solo cómo se lee.
- **La tabla sigue siendo tabla**: el usuario puede comparar columnas alineadas de un vistazo (deslizando), que es justo el punto de usar una tabla en vez de una lista — apilarla en tarjetas pierde esa comparación espacial y termina pareciendo una lista con pasos extra.

```
┌─────────────────────────────────────┐
│  🌲 │ Estos son los resultados:        │
│     │                                    │
│     │ ┌───────────────────────────┐→   │  ← container propio, borde
│     │ │ Nombre    │ Tamaño │ Fecha │    │     hairline + fill cardFillHigh
│     │ │───────────┼────────┼───────│    │     en el header, scroll
│     │ │ factura...│ 204 KB │ 12/08 │→   │     horizontal si no entra
│     │ └───────────────────────────┘    │     (flecha = hay más al costado)
└─────────────────────────────────────┘
```

- **Estilo del container**: mismo lenguaje visual que el approval card (`chat_screen.dart:766`) — `BorderRadius.circular(12)` (un poco menos que los 16 del approval card, para que se lea como elemento "menor" dentro del mensaje, no como una card independiente), `border: Border.all(color: YggColors.hairline)`, sin fill propio en el cuerpo (deja ver el `bg` de atrás, consistente con que el mensaje del assistant no tiene card).
- **Header de la tabla**: fill `YggColors.cardFillHigh` (el mismo tono que ya separa visualmente secciones en otras cards), texto `YggColors.text` en negrita (`fontWeight: FontWeight.w600`), para que se distinga de las filas de datos sin necesitar un color nuevo.
- **Filas de datos**: sin fill (transparente, deja ver `bg`), separadas por una línea `YggColors.hairline` de 1px entre filas — igual criterio que el `dividerColor: YggColors.hairline` ya definido en el tema (`ygg_theme.dart:51`). Texto `YggColors.text` a fontSize ~14 (un poco menor al cuerpo, 15.5, para que la tabla se sienta "densa"/de referencia, no como prosa).
- **Indicador de scroll**: un `Container` angosto con gradiente hacia `bg` en el borde derecho cuando el contenido excede el ancho visible (mismo patrón visual que cualquier carrusel horizontal) — señal barata de "hay más para el costado" sin agregar texto ni flechas explícitas. Si no vale la pena el gradiente en la primera pasada, alcanza con que el propio corte abrupto de una columna a mitad ya sugiera scroll — no bloqueante.

---

## 3. Code blocks — monoespaciado con container propio, scroll horizontal por línea larga

Arquitecto ya cerró "monoespaciado plano, sin syntax highlighting en v1" (`markdown-streaming-render-design.md` §4) — acá defino el estilo:

```
┌───────────────────────────────────┐
│  DART                              │  ← badge de lenguaje (info-string del
├───────────────────────────────────┤     fence), mismo tratamiento visual
│  void main() {                     │     que el risk-badge del approval
│    print('hola');                  │     card — monospace, caps, letter-
│  }                                 │     spacing, borde sutil accent
└───────────────────────────────────┘
```

- **Container**: `BorderRadius.circular(10)`, fill `YggColors.cardFillHighest` (el tono más marcado de los dos disponibles — el código es contenido primario, no metadata secundaria como el JSON de args del approval card, así que se justifica un fill más presente), sin borde adicional (el fill ya lo separa del fondo, un borde encima sería redundante a diferencia de la tabla en §2 que no tiene fill propio).
- **Texto**: `fontFamily: 'monospace'`, `fontSize: 13.5`, color `YggColors.text` a opacidad plena (a diferencia del JSON de args del approval card que usa `Color.fromRGBO(244, 239, 230, 0.6)`, `chat_screen.dart:793` — ahí el JSON es metadata secundaria dentro de una card ya densa en información; acá el bloque de código puede ser la respuesta entera, merece full contraste).
- **Badge de lenguaje** (solo si el fence trae info-string, ej. ` ```dart `): reutiliza el mismo tratamiento visual que el risk-badge (`chat_screen.dart:779-786` — `fontFamily: monospace`, `fontSize: 10`, `letterSpacing: 0.8`, color `accent`, borde `Color.fromRGBO(201,165,78,0.55)`) en vez de inventar un estilo nuevo — mismo lenguaje visual para "etiqueta corta en mayúsculas" en toda la app. Si no hay info-string, no se muestra nada (no forzar un "TEXTO" o "CODE" genérico).
- **Líneas largas: scroll horizontal, nunca wrap** — envolver el `Text` en `SingleChildScrollView(scrollDirection: Axis.horizontal)`. Es la convención universal de cualquier visor de código (VS Code, GitHub, terminales) — hacer wrap rompe la indentación y el sentido visual del código, y el usuario que copia con el botón de abajo de todos modos se lleva el texto real, no lo que se ve envuelto.
- **Botón de copiar**: mismo patrón que ya existe para el mensaje completo del assistant (`chat_screen.dart:662-669`, pill con borde `hairline` y texto "Copiar") — repetido por bloque de código individual, no solo al pie del mensaje entero, porque un mensaje puede traer más de un bloque y el usuario normalmente quiere UNO en particular, no el mensaje completo con prosa alrededor.

### Código inline (`` `texto` ``)

Sin container ni badge — un `TextSpan` con `fontFamily: monospace`, mismo `fontSize` que el texto que lo rodea (15.5) para no romper el ritmo de lectura, y fill `YggColors.cardFillHigh` aplicado como fondo del span (un `WidgetSpan` con `Container` chico, padding horizontal ~4, `borderRadius: 4`) — suficiente para que se note como "esto es código" sin la ceremonia de un bloque completo.

---

## 4. Bold / itálica / listas / links — estilo concreto

Todos parten de la base ya establecida (`chat_screen.dart:642`): `fontWeight: w300`, `fontSize: 15.5`, `height: 1.6`, color `YggColors.text`.

- **Bold**: mismo color y tamaño, `fontWeight: FontWeight.w600` (no `bold`/`w700` — el peso base ya es liviano (`w300`), saltar directo a `w700` se sentiría demasiado brusco al lado de un cuerpo tan liviano; `w600` da contraste suficiente sin desentonar).
- **Itálica**: mismo color/peso, `fontStyle: FontStyle.italic` — sin cambiar color ni opacidad, la itálica ya es distinguible por sí sola y bajarle contraste además sería sobre-marcar el énfasis.
- **Listas**: mismo tamaño/altura de línea que el párrafo (`15.5`/`1.6`, para que una lista no se sienta "más apretada" que el texto de alrededor). Marcador (bullet `•` o número) en color `accent` (`#C9A54E`) en vez de `text` — es un detalle chico pero le da identidad de marca a un elemento que en la mayoría de las apps de chat es gris genérico, y reusa un color que la app ya usa para "esto es interactivo/destacado" (risk-badge, probablemente CTAs). Indentación estándar (~20-24dp), sub-listas con indent adicional del mismo valor, sin tratamiento especial.
- **Links**: color `accent` + `TextDecoration.underline` — el underline es necesario acá aunque el color ya distinga, porque `accent` sobre `bg` oscuro puede no leerse como "tappable" solo por el color para alguien que no conoce la convención de la app (a diferencia de web, donde el usuario ya espera que el dorado/celeste sea link); el underline es la señal universal que no depende de aprender la paleta. **Sí, tappable** — `url_launcher` (`pubspec.yaml:43`) ya está en el proyecto, abrir en el navegador externo del sistema (`launchUrl` con `LaunchMode.externalApplication`) sin ningún gate de approval (es una acción iniciada por tap directo del usuario sobre contenido ya mostrado, no una tool call del modelo — no aplica el mismo criterio de riesgo que `mobile-chat-ux-flows.md` §4). Único punto técnico a resolver aparte (no bloqueante para este doc): qué pasa si el modelo genera un esquema no-http (`mailto:`, `tel:`, algo inventado) — dejarlo intentar `launchUrl` igual y que el propio SO decida si hay una app que lo maneje, sin validación previa del lado de la app.
- **Headers**: `h1`/`h2`/`h3` → mismo color `text`, `fontWeight: w600` (igual que bold), tamaños `20`/`18`/`16.5` (bajando desde el `15.5` base, nunca por debajo), con `SizedBox(height: 12)` de espacio arriba y `6` abajo para que corten visualmente el flujo de prosa sin sentirse pegados.

---

## 5. Opinión sobre streaming: plano-hasta-el-final vs. parseo en vivo

**Aclaración antes de opinar — posible desalineación con lo que se me transmitió**: el pedido decía que Architect cerró "plano mientras `streaming=true`, recién parsea al terminar" (opción **b** de `markdown-streaming-render-design.md` §1). Leyendo el doc yo mismo, la decisión que realmente queda escrita en su §6 punto 1 es la contraria: **"parseo en vivo con throttle + heurística de cola insegura (opción **c**) — no plano-hasta-el-final"**, con (b) anotada solo como *fallback* más barato si se prefiere iterar. Puede que haya una ronda posterior que revirtió a (b) y no llegó a este doc, o que se me haya transmitido mal el resumen — aviso la discrepancia en vez de opinar sobre una premisa que el propio doc de Architect no sostiene. Opino sobre las dos, para que sirva cualquiera sea la vigente:

**Sobre (c) (lo que el doc dice que está cerrado)**: de acuerdo, sin reservas. El argumento de Architect (§1: un mensaje largo se lee como pared de texto plano y "salta" de golpe a formato final justo cuando el usuario ya está leyendo) es el motivo correcto — ese salto brusco es peor UX que cualquier costo de la heurística de cola insegura. Un matiz que sí es mío, respondiendo la pregunta abierta que Architect dejó en su §5: la cola insegura (el texto que todavía no se sabe si es markdown completo) debería renderizarse **con el mismo estilo que la prosa normal, sin atenuar opacidad ni nada que la marque como "en construcción"** — el caret parpadeante ya cumple ese rol de señalar "esto sigue llegando"; agregarle además una opacidad reducida sería apilar dos señales para lo mismo, y el efecto real (ver un `**` o `[` literal por una fracción de segundo antes de que cierre y se formatee) es exactamente lo que ya pasa en ChatGPT/Claude web — un comportamiento que el usuario ya conoce de esas referencias, no hace falta suavizarlo más.

**Sobre (b) (lo que se me transmitió como cerrado)**: si en la práctica es la que se implementó, no es una mala decisión — es más simple y sin ningún riesgo de parpadeo de marcador a medio cerrar — pero sí hereda el costo que el propio Architect nombra: un mensaje de varios segundos de streaming se lee en texto plano puro (sin ninguna de las prioridades de §1 visible) hasta que termina, momento en el que todo el formato aparece de golpe. Mi opinión, si esta es la ruta real: aceptable como v1 más barato de entregar, pero vale la pena confirmar con Architect cuál de las dos quedó realmente implementada antes de que Frontend arranque, para no terminar escribiendo estilos (`MarkdownStyleSheet`) pensados para un mecanismo que no es el real.

---

## 6. Resumen

1. **Prioridad**: bold/itálica/listas/links primero (mismo costo, alta frecuencia) → headers/código inline → code blocks → tablas al final (más costo de layout, menor frecuencia).
2. **Tablas**: scroll horizontal dentro de un container propio (borde `hairline`, header con fill `cardFillHigh`), no tarjetas apiladas — consistente con el mismo patrón de scroll que los code blocks, y más barato de implementar sobre el widget que el paquete de renderizado ya da de fábrica.
3. **Code blocks**: container con fill `cardFillHighest`, monospace `text` a opacidad plena, badge de lenguaje reusando el estilo del risk-badge existente, scroll horizontal por línea larga (nunca wrap), botón de copiar por bloque.
4. **Bold/itálica/listas/links**: sobre la base tipográfica ya existente (`w300`/`15.5`/`1.6`/`text`) — bold en `w600`, itálica sin cambio de color, marcador de lista en `accent`, links en `accent` + underline + tappable vía `url_launcher` (ya en el proyecto).
5. **Streaming**: de acuerdo con la opción (c) que el doc de Architect dice tener cerrada (parseo en vivo, no plano-hasta-el-final) — marqué la discrepancia con lo que se me transmitió para que se confirme cuál es la real antes de implementar estilos.
