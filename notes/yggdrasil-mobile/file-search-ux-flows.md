# UX: búsqueda real de archivos — tool nuevo (reemplaza picker-como-búsqueda)

Estado: **propuesta, con §4 (permisos) ya corregida contra el contrato real que devolvió Architect** (tool `phone_find_files`, `handleFindFiles` nativo — pane "Architect — file search"). El resto (N de truncamiento, shape de `scope`, riskLevel) sigue a reconciliar, ver §8. Donde hace falta un número concreto para poder diagramar el flujo (§3), uso **N=15** como sugerencia, no como valor cerrado.
Basado en: pedido del usuario (tarea de esta sesión) + convenciones ya establecidas en `mobile-chat-ux-flows.md` (§3 tool-card `sync`, §5.2 bloqueo de composer, patrón nudge-message de retry) + `home-screen-voice-input-ux.md` (criterio "spinner solo cuando algo carga de verdad, no cuando se espera a un humano").
Alcance: SOLO el tool nuevo de búsqueda real (sin UI, resultados directo al modelo). El picker manual actual (SAF, `phone_search_files`/`phone_list_documents` tal como existen hoy en `device_tool_specs.dart:44-63` y `device_tools_channel.dart:24-47`) sigue existiendo como acción separada ("abrí la app de archivos") — ver §7. No toco código.

---

## 0. Punto de partida

Hoy, "buscá el archivo X" dispara `phone_search_files` (`kind:"interactive"`, `device_tool_specs.dart:44-55`), que abre el picker SAF nativo y **no busca nada** — el humano navega a mano hasta encontrar el archivo. Es el patrón `awaiting_user` completo de `mobile-chat-ux-flows.md` §5 (approval → "Esperando selección en tu teléfono..." → resultado).

Nombre final confirmado por Architect/Frontend: el tool nuevo es **`phone_find_files`** (nativo: `handleFindFiles`), ya en implementación en paralelo (pane "Frontend — phone_find_files impl").

El tool nuevo cambia la categoría de interacción: es `kind:"sync"` (como `phone_open_app`, §3 de `mobile-chat-ux-flows.md`), no `kind:"interactive"` — no hay humano esperando en el medio, así que **no aplica la máquina de estados de §5** (nada de "esperando selección", nada de picker que cancelar). Aplica la de §3: ejecuta, resuelve, listo. Esto importa porque cambia qué card se muestra: una `SyncToolCard` compacta que resuelve sola, no la card `awaiting_user` con botón Cancelar.

Consecuencia directa para approval: los 4 tools de v1 están mapeados `riskLevel: safe` (`device_tool_specs.dart:34/41/54/62`) y en modo `auto`/`yolo` eso no muestra approval card (`mobile-chat-ux-flows.md` §4). Si el tool nuevo de búsqueda hereda `safe` (razonable — leer nombres/metadata de archivos no es más riesgoso que listar apps instaladas), **tampoco va a mostrar approval card** salvo que Architect decida lo contrario por tocar `MediaStore`/almacenamiento. Asumo `safe` abajo; si Architect lo sube a `moderate`, el único cambio es que aparece la approval card de §4 antes del flujo de este doc — el flujo posterior no cambia.

---

## 1. Flujo feliz (referencia)

```
usuario: "buscá el archivo de la factura de luz"
      │
      ▼
modelo invoca tool nuevo (query:"factura de luz", ...)
      │
┌─────────────────────────────────┐
│ ⏳ Buscando "factura de luz"...   │  ← SyncToolCard, mismo tratamiento
└─────────────────────────────────┘     visual que "Abriendo Spotify..."
      │                                  (§3 mobile-chat-ux-flows.md)
      ▼ resultado (1-N matches, ver casos abajo)
┌─────────────────────────────────┐
│ ✓ Encontré 1 archivo             │  ← card se resuelve a resumen de
└─────────────────────────────────┘     una línea, igual que sync hoy
      │
      ▼
modelo (burbuja normal): "Encontré factura-luz-agosto.pdf en
Descargas, del 3 de agosto. ¿Querés que la abra?"
```

- Sin picker, sin salir de la app, sin esperar al usuario en ningún punto intermedio — coherente con el pedido ("sin abrir ninguna UI").
- El modelo es quien narra los resultados en su respuesta (mismo criterio que `phone_list_installed_apps`, `mobile-chat-ux-flows.md:133`) — la card solo marca que la búsqueda corrió y cuántos matches trajo, no lista los archivos ella misma. Evita duplicar la información (card + texto del modelo diciendo lo mismo dos veces).
- Timeout de ejecución: mismo patrón que §3 (~30s sugerido, a confirmar con Architect si el filesystem grande necesita más margen — ver §6).

---

## 2. Caso: 0 resultados

### Qué le llega al modelo

```json
{
  "status": "empty",
  "query": "factura de luz",
  "scope": "descripción corta del alcance real buscado, ej. \"almacenamiego interno, todos los tipos\" — la da Architect según qué MediaStore/scoped-storage realmente cubrió",
  "suggestion": "broaden_or_check_spelling"
}
```

Campos clave que el modelo necesita para no inventar: **qué buscó exactamente** (`query` tal cual se la pasaron, para poder citarla al usuario) y **qué alcance cubrió** (`scope`) — sin esto el modelo no puede distinguir "no existe" de "busqué mal/en el lugar equivocado", y termina diciendo "no encontré nada" a secas, que es la peor respuesta posible cuando en realidad el archivo está en una carpeta que el scope no cubrió (ver Android 11+ scoped storage — problema que Architect está resolviendo en paralelo, no técnico de este doc, pero el modelo necesita saber qué quedó afuera para ser honesto al respecto).

### Qué se espera que diga el modelo (variaciones de copy, no texto fijo — el modelo redacta)

- Ortografía/término: *"No encontré nada con 'factura de luz'. ¿Puede que el nombre sea distinto? Probá decirme parte del nombre o la extensión (ej. '.pdf')."*
- Ampliar alcance: *"No until encontré nada en [scope]. Si sabés en qué carpeta está o el tipo de archivo, buscá de nuevo con más pistas."* (el modelo debería usar el `scope` real, no un genérico)
- Fallback manual, **siempre como opción, no como único camino**: *"Si no aparece, puedo abrirte el buscador de archivos del teléfono para que lo encuentres vos."* — ofrecerlo, no forzarlo (ver §7 sobre cuándo el modelo debe ofrecerlo proactivamente vs. solo si el usuario insiste).
- Evitar: devolver el `status:"empty"` crudo o decir simplemente "no hay resultados" sin ninguna de las dos salidas (afinar o pickear a mano) — 0 resultados nunca debería ser un callejón sin salida en la respuesta del modelo.

---

## 3. Caso: muchos resultados (truncado)

**"Muchos" = sugerido N=15** (a reconciliar con el límite real que fije Architect — si el contrato técnico ya trae un número, ese gana). Truncar y avisar, no pedir refinar a ciegas antes de mostrar nada: el usuario casi siempre reconoce el archivo que quiere apenas ve la lista, así que mostrar los primeros N con contexto suficiente para elegir es mejor UX que un intercambio extra de "sé más específico" antes de ver una sola opción.

### Orden de los N que se muestran

Relevancia de nombre primero, fecha como desempate — no fecha pura, porque "buscá la factura de luz" con 40 PDFs debería priorizar el que matchea mejor el nombre, no el descargado más reciente que puede no tener nada que ver:

1. Coincidencia exacta de nombre (sin extensión)
2. Nombre que empieza con el query
3. Nombre que contiene el query en cualquier posición
4. Dentro de cada grupo, más reciente primero (fecha de modificación desc)

### Qué le llega al modelo

```json
{
  "status": "truncated",
  "query": "factura",
  "matches": [ /* primeros N, orden de arriba, con name/path/size/type/date */ ],
  "shown": 15,
  "totalFound": 47,
  "truncatedCount": 32
}
```

`totalFound`/`truncatedCount` explícitos — sin esto el modelo no puede decir honestamente "hay más" ni cuántos, y termina o bien inventando un número o bien omitiendo el dato (el usuario cree que vio todo cuando en realidad quedaron 32 afuera).

### Qué se espera que diga el modelo

- *"Encontré 47 archivos con 'factura' — te muestro los 15 más relevantes. Si no está el que buscás, decime más (tipo de archivo, carpeta, fecha aproximada) y afino la búsqueda."*
- Si entre los 15 mostrados hay uno que matchea claramente mejor que el resto (grupo 1 o 2 de arriba con un solo resultado), el modelo debería poder destacarlo en vez de listar los 15 en bruto — pero eso es redacción del modelo, no algo que el tool deba resolver; el orden ya se lo deja servido.
- Evitar: mostrar los 15 sin mencionar que hay 32 más — es la misma trampa que 0 resultados pero al revés (el usuario cree que no existe algo que sí existe, solo que quedó truncado).

---

## 4. Caso: falta permiso

**Corregido contra el contrato real de Architect (pane "Architect — file search", respuesta del 2026-09-06) — versión anterior de esta sección asumía un JSON estructurado con `canAskAgain` que NO es viable a nivel nativo.** Contrato real, citado tal cual del pane:

- `handleFindFiles` (nativo) chequea permisos ANTES de correr cualquier búsqueda. Si falta algo, devuelve error inmediato — **mismo mecanismo que `cancelled_by_user` hoy** (`device_tools_channel.dart:21-23`, `PlatformException` reenviada tal cual): `result.error("permission_required", "READ_MEDIA_IMAGES,READ_MEDIA_VIDEO not granted", null)`. Viaja al modelo como error de tool call **plano** (código + mensaje en texto), no como `matches:[]` ni como el JSON con flags que yo había propuesto — cero protocolo nuevo, según Architect.
- **Limitación real, no de diseño**: `checkSelfPermission` (lo que usa ese chequeo nativo) **no distingue** "nunca se pidió" de "el usuario lo negó explícitamente" — mismo mensaje en los dos casos. Mi supuesto original de un campo `canAskAgain` en la respuesta del tool no tiene de dónde salir a ese nivel — se cae esa parte del contrato de la versión anterior.
- El pedido REAL del diálogo de Android (`permission_handler`, mismo paquete/patrón que ya usa el mic en `home-screen-voice-input-ux.md`) — que sí puede distinguir retryable de `permanentlyDenied`, pero recién después de intentar pedirlo — **queda del lado Flutter, fuera del tool call**. Architect lo dejó abierto explícitamente para UX: "cuándo/cómo mostrarlo lo dejo abierto para UX". Lo que sigue es esa decisión.

### 4.1 Cuándo se dispara el pedido real de permiso (respondiendo el punto abierto)

**Lazy y automático, sin tap extra**: la primera vez que la app ve el error `permission_required` de `phone_find_files` en la sesión, dispara `permission_handler.request()` como efecto secundario — mismo criterio "no se pide al abrir la app, se pide al primer uso real" ya usado para el mic. Como `phone_find_files` es `sync` (§0) y el error ya cerró la tool call, esto no bloquea nada: el turno del modelo ya está resuelto, el diálogo del SO aparece en paralelo, no en el medio de un estado de espera nuevo.

```
tool call falla → error "permission_required" (plano, sin distinción)
      │
      ├─► el modelo recibe el error y responde su turno normal
      │   (copy único abajo — el modelo NO sabe si es retryable o
      │   permanente, así que no debe inventar esa distinción)
      │
      └─► EN PARALELO, client-side, primera vez en la sesión:
          dispara permission_handler.request()
          → diálogo nativo del SO (no es UI de la app)
                │
                ├── Permitido → nada que mostrar ahora — la
                │   PRÓXIMA vez que el usuario pida buscar, ya
                │   funciona directo, sin aviso de por medio
                │
                └── Denegado → RECIÉN ACÁ permission_handler.status
                    distingue (Android no lo permitía antes):
                    │
                    ├── retryable → no hace falta avisar nada
                    │   extra — el modelo ya dijo "pedime de
                    │   nuevo" y el próximo intento vuelve a
                    │   disparar el diálogo
                    │
                    └── permanentlyDenied → única vez, línea de
                        sistema NO bloqueante en el chat: "Podés
                        habilitar el acceso a archivos en Ajustes
                        de la app" + botón [Abrir ajustes] — una
                        sola vez por sesión, no repetir en cada
                        búsqueda fallida siguiente
```

### 4.2 Copy del modelo (una sola variante — no hay distinción que el modelo pueda usar)

*"No tengo permiso para buscar archivos en el teléfono. Puede que te haya aparecido un pedido de permiso en la pantalla — si lo aceptás, pedime que busque de nuevo. Si no, puedo abrirte el buscador de archivos del teléfono, que no necesita este permiso."* — el modelo **no debe decir** "denegado permanentemente" ni nada por el estilo: no lo sabe (ver limitación de arriba), y si lo permanente aplica, es la línea de sistema de §4.1 (no el modelo) la que ofrece Ajustes.

### 4.3 Permisos básicos concedidos pero cobertura parcial (media-only, "todavía no cubre todo")

Caso distinto al de arriba — **no es falta de permiso, es permiso de alcance reducido**: el usuario concede los permisos "básicos" (los granulares de media — `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`/`READ_MEDIA_AUDIO`, o el acceso "fotos seleccionadas" de Android 14+), que cubren fotos/videos/audio vía MediaStore pero **no** documentos genéricos (PDFs, `.docx`, etc. fuera de esas categorías) sin acceso más amplio. Acá `handleFindFiles` NO falla — corre, encuentra lo que puede dentro de lo que sí tiene permiso — pero si la búsqueda es por algo fuera de ese alcance (ej. un PDF), el resultado puede ser "0 resultados" o "resultados incompletos" **por una razón estructural de permisos, no porque el archivo no exista**, y eso es justo la peor combinación (parece un `empty` normal pero no lo es).

**Propuesta de nombre — no como `status` nuevo mutuamente excluyente, sino como flag adjunto a cualquier resultado** (`ok`, `empty`, o `truncated` pueden venir todos con esto encima, porque "encontré 2 fotos pero no busqué en documentos" y "no encontré nada y tampoco busqué en documentos" son momentos de copy distintos — colapsarlos en un solo status nuevo perdería esa diferencia):

```json
{
  "status": "empty",           // o "ok" / "truncated", sin cambios en esos shapes
  "scopeLimited": true,
  "uncoveredKinds": ["documents", "pdf", "other"]  // qué tipos NO se pudieron cubrir
}
```

Si Architect prefiere no tocar cada status con un campo extra y quiere algo más simple, la alternativa que pide el pedido original es un status dedicado — sugiero **`partial_scope`** (o `limited_scope`) usado solo cuando la búsqueda corrió bajo permisos reducidos, con `matches[]` igual presentes si los hay — pero mi recomendación es el flag adjunto de arriba, porque preserva la distinción entre "no había nada visible" y "sí había cosas, pero quedó afuera lo no-media".

**Copy esperado del modelo** cuando viene `scopeLimited: true`: *"Encontré [N/nada] entre fotos, videos y audio — pero solo tengo permiso para esos tipos, así que si tu archivo es un documento (PDF, Word, etc.) no lo pude ver. Dame más acceso en Ajustes, o te abro el buscador de archivos del teléfono, que sí ve todo."* — nunca omitir el aviso de cobertura parcial cuando viene el flag, aunque haya matches — es la misma regla de honestidad de §3 (no ocultar qué quedó afuera), aplicada a permisos en vez de truncamiento.

### 4.4 `MANAGE_EXTERNAL_STORAGE` — acceso ampliado, **validado en hardware real (Samsung), ya no es v2** (actualiza §8 punto 4/8 de la versión anterior)

Corrección de estado: la versión anterior de este doc trataba `MANAGE_EXTERNAL_STORAGE` como "fuera de v1, anotado" (heredado de `phone-find-files-design.md` §1.3 original). **Ya no es así** — Architect lo cerró en la misma ronda (`phone-find-files-design.md` §7) y el usuario lo validó en el Samsung físico: con el permiso otorgado, la búsqueda encontró PDFs reales en `Downloads/` que antes daban 0 resultados. Está en v1, confirmado, no es una decisión pendiente.

Campo nuevo, **distinto de `scopeLimited`** (es un eje independiente — puede venir junto): `broaderAccessAvailable` (bool), presente **solo cuando `MANAGE_EXTERNAL_STORAGE` NO está otorgado todavía**:

```json
{
  "matches": [ /* lo que encontró en el alcance actual */ ],
  "total": 1,
  "truncated": false,
  "broaderAccessAvailable": true
}
```

- Ausente (no `false`) cuando ya está otorgado — mismo criterio de ausencia-como-default que `scopeLimited`.
- El `scope` del caso `empty` (§2) ahora refleja el permiso real al momento de la búsqueda: `"todos los archivos del almacenamiento externo"` si `MANAGE_EXTERNAL_STORAGE` está otorgado, o el texto de siempre (subconjunto media/Downloads) si no.
- **Copy esperado del modelo** cuando viene `broaderAccessAvailable: true` (independiente de si hubo matches o no): *"Encontré esto entre fotos/videos/lo indexado — si buscás algo como un documento en otra carpeta, puedo ver todo el almacenamiento si me das el permiso 'Acceso a todos los archivos' en Ajustes."* El modelo decide si vale la pena mencionarlo según el contexto — no hace falta forzarlo en cada respuesta si ya encontró justo lo que el usuario pedía.
- **Matiz a tener presente, no de UX pero relevante para no prometer de más**: `MANAGE_EXTERNAL_STORAGE` se otorga vía pantalla de Ajustes del sistema (`Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`), **no** un diálogo runtime simple — Android no devuelve un resultado sincrónico al volver de esa pantalla (a diferencia de `READ_MEDIA_*`/`permission_handler.request()`, que sí resuelve granted/denied al toque). La app se entera recién en el próximo `phone_find_files` real (detección lazy, mismo patrón que el resto del gate). Esto importa para `capabilities-settings-ux.md` §4 — ver addendum ahí.

---

## 5. Errores / edge cases generales

| Caso | Qué devuelve el tool al modelo | Qué se espera del modelo |
|---|---|---|
| Timeout de búsqueda (filesystem grande) | `{"status":"timeout","partialMatches":[...] // si el motor pudo devolver algo parcial antes de cortar, si no array vacío}` | Decir que la búsqueda tardó más de lo esperado; si hay `partialMatches`, ofrecerlos aclarando que es parcial ("until encontré esto antes de que se cortara, puede no ser todo"); ofrecer refinar (nombre más específico, subcarpeta) para acotar la próxima. |
| Query vacía | El tool no debería ni ejecutar un escaneo de "todo el dispositivo" sin término — validación antes de tocar filesystem: `{"status":"invalid_query","reason":"empty"}` | El modelo debería, en la práctica, nunca llegar a mandar esto (el parámetro debería ser requerido a nivel de schema — decisión de Architect, no de este doc). Si igual llega, pedirle al usuario un nombre o parte de él antes de reintentar — nunca reintentar solo con la misma query vacía. |
| Caracteres raros/wildcards en el patrón (`*`, `?`, símbolos) | El tool trata el patrón como texto/glob según defina Architect, pero **nunca debe crashear o devolver una excepción cruda** — si el patrón es inválido para el motor de búsqueda, `{"status":"invalid_query","reason":"unsupported_pattern"}` con el motivo en texto llano, no un stack trace | Explicar en criollo qué no se pudo interpretar y sugerir simplificar (sacar símbolos, usar solo parte del nombre) — nunca repetir el error técnico tal cual al usuario. |
| Usuario cambia de tema a mitad de búsqueda | No aplica un mecanismo nuevo: el composer ya queda bloqueado durante cualquier turno en curso (`mobile-chat-ux-flows.md` §5.2 — la regla de concurrencia de `chat.send` es general, no específica del picker), así que el usuario no puede literalmente "cambiar de tema" mientras la búsqueda corre — tiene que esperar a que la card resuelva (feliz, timeout, o error) antes de mandar el mensaje siguiente. Si el resultado llega cuando la conversación ya "se sintió" para el usuario como que había pasado a otra cosa, la card igual aparece en su lugar en el historial (append lineal, mismo criterio que el resto de las tool-cards) — el modelo, al recibir el resultado, decide si vale la pena retomarlo o dejarlo como dato disponible sin forzar el tema si el usuario ya siguió con otra cosa en su próximo mensaje. |

---

## 6. Resumen — shape que necesita el modelo por estado

Tabla de referencia rápida (no reemplaza el contrato real de Architect, es la vista "qué necesito para redactar bien" desde el lado UX):

| Estado | Campos mínimos que el modelo necesita | Por qué |
|---|---|---|
| `ok` (1..N ≤ límite) | `matches[]` (name/path/size/type/date), `query`, `scopeLimited`+`uncoveredKinds` si aplica (§4.3), `broaderAccessAvailable` si aplica (§4.4) | Narrar resultados con contexto (dónde, cuándo) |
| `empty` | `query`, `scope`, `scopeLimited`+`uncoveredKinds` si aplica (§4.3), `broaderAccessAvailable` si aplica (§4.4) | Distinguir "no existe" de "no busqué donde estaba" |
| `truncated` | `matches[]` (primeros N), `shown`, `totalFound`, `truncatedCount` | No mentir por omisión sobre cuánto quedó afuera |
| `permission_required` (error plano, NO JSON estructurado — §4) | código+mensaje de error tal cual, sin `canAskAgain` (Android no lo distingue a este nivel) | El modelo usa el copy único de §4.2 — la distinción retryable/permanente la maneja la app, no el modelo |
| `timeout` | `partialMatches[]` (puede ser vacío) | Ofrecer lo parcial si hay, sin fingir que es todo |
| `invalid_query` | `reason` (string legible, no excepción cruda) | Explicar en criollo, no repetir el error técnico |

Ningún estado debería llegar al modelo como una excepción sin traducir o un `ok:false` sin motivo. Única excepción real a "siempre JSON con campos": `permission_required`, que por diseño de Architect viaja como error plano (mismo mecanismo que `cancelled_by_user`) — el resto sí lleva los campos de arriba.

---

## 7. El picker manual sigue existiendo, aparte

Cuando el usuario pide explícitamente "abrí la app de archivos" (o variantes: "abrime el buscador de archivos", "dejame elegir a mano"), se usa el flujo actual **sin cambios** — el picker SAF interactivo tal como está descripto en `mobile-chat-ux-flows.md` §5 (approval → "Esperando selección en tu teléfono..." → resultado/cancelado). Es una acción distinta, no un fallback automático del tool de búsqueda — dos tools separados, dos intents separados.

El modelo SÍ debería **ofrecer** este picker (no ejecutarlo solo) como salida en tres momentos puntuales ya cubiertos arriba:
1. 0 resultados (§2) — como alternativa si afinar el término tampoco ayuda.
2. Permiso bloqueado permanentemente (§4.2) — como salida real, porque el picker SAF no necesita este permiso.
3. Timeout repetido (§5) — si refinar tampoco resuelve, elegir a mano es la salida de último recurso.

Nunca de forma proactiva en el flujo feliz (§1) ni cuando hay resultados de sobra (§3) — ahí el picker sería un paso atrás, no una ayuda.

---

## 8. Abierto para Architect

1. **N real de truncamiento** — uso 15 acá, reconciliar con lo que cierre el contrato técnico.
2. ~~Nombre final del tool~~ — **cerrado**: `phone_find_files` (§0).
3. **`riskLevel`** del tool nuevo — asumí `safe` (§0); si es `moderate`+, se antepone la approval card de `mobile-chat-ux-flows.md` §4 antes de todo lo de acá, sin otro cambio.
4. **Shape exacto de `scope`** en `empty` (§2) — depende de qué cubre MediaStore vs. scoped storage realmente, que es justo lo que Architect está resolviendo.
5. **Timeout numérico** de búsqueda (§1/§5) — sugiero alinear con el ~30s ya usado para `sync` tools en `mobile-chat-ux-flows.md` §3, ajustable si el escaneo real en Android 11+ necesita más margen.
6. **Nombre del status/flag de §4.3** (`scopeLimited`/`partial_scope`/`limited_scope`) — propuesto acá, a cerrar con Architect junto con qué `uncoveredKinds` puede reportar realmente (depende de qué permisos granulares terminen pidiéndose).
