# Diseño: búsqueda real de archivos (`phone_find_files`) — separación de `phone_search_files`

Estado: **diseño cerrado — §7 (`MANAGE_EXTERNAL_STORAGE`) implementado y validado en Samsung real por el usuario** (§7.4, hallazgo post-implementación). El resto del doc (§1-6) sigue siendo diseño de referencia para lo ya construido.
Basado en: lectura del código actual (`lib/services/device_tool_specs.dart`, `lib/services/device_tools_channel.dart`, `lib/standalone/device_tool_executor.dart`, `lib/services/yggdrasil_client.dart`, `android/app/src/main/kotlin/com/example/app/MainActivity.kt`, `android/app/src/main/AndroidManifest.xml`, `pubspec.yaml`, `lib/chat/voice_mic_button.dart`) + las decisiones ya cerradas en `external-actions-and-connectors-analysis.md` (criterio `safe`/`moderate`, relación `kind`↔checkpoint humano) y `remote-access-analysis.md` §7.2 (gate mínimo de standalone, tratamiento uniforme de los 4 `phone_*`) y `phone-gateway-connectivity-design.md` §3 (protocolo `sync`/`interactive`, convención de forwardear el string de error tal cual).
Fecha: 2026-09-06.

## 0. El problema, en una frase

`phone_search_files` (`lib/services/device_tool_specs.dart:44-55`) no busca nada — abre `ACTION_OPEN_DOCUMENT` (SAF) y espera a que un humano elija 1 archivo a mano (`MainActivity.kt:104-120`, comentario propio en `MainActivity.kt:99-103` ya lo documenta como picker, no búsqueda). El pedido del usuario es que "buscar archivo X" dispare una consulta real (MediaStore) sin picker, y que abrir el picker de verdad quede como una acción distinta y explícita.

## 1. Búsqueda real en Android 11+ sin picker — API, permisos y alcance honesto

### 1.1 Qué API usar: una sola consulta contra `MediaStore.Files`, no tres

Android indexa todo archivo compartido (imágenes, video, audio, y lo que caiga en `Downloads/`) en una tabla única subyacente. En vez de consultar `MediaStore.Images`/`Video`/`Audio` por separado, alcanza con una sola query contra la colección genérica:

```kotlin
val collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)
val projection = arrayOf(
    MediaStore.Files.FileColumns._ID,
    MediaStore.Files.FileColumns.DISPLAY_NAME,
    MediaStore.Files.FileColumns.SIZE,
    MediaStore.Files.FileColumns.MIME_TYPE,
    MediaStore.Files.FileColumns.DATE_MODIFIED,
)
val selection = "${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ?" +
    (if (mimeType != null) " AND ${MediaStore.Files.FileColumns.MIME_TYPE} = ?" else "")
```

**Por qué una sola query y no tres**: qué filas devuelve esa consulta depende exclusivamente de qué permisos tiene otorgados la app en ese momento (ver 1.2) — el sistema operativo filtra las filas visibles, no hace falta que el código elija manualmente "esto es imagen, consultá la colección de imágenes". Es menos código y evita tener que mapear extensión→colección a mano.

Orden por `DATE_MODIFIED DESC`, límite vía `Bundle` con `ContentResolver.QUERY_ARG_LIMIT` (API 30+) o recorte manual del cursor en versiones más viejas.

### 1.2 Permisos reales (no lo que "debería" alcanzar, lo que realmente hace falta)

Ningún permiso hace falta para que la app vea **sus propios** archivos insertados en MediaStore — irrelevante acá, esta app nunca escribe media. Lo que el usuario pide ("buscar archivo de otra app / bajado por el navegador / etc.") es ver filas que **no son propias**, y ahí sí hace falta permiso runtime, distinto por versión de Android:

- **Android 13+ (API 33+)**: permisos granulares por tipo, cada uno independiente — `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO`. `READ_EXTERNAL_STORAGE` queda deprecado para estos tipos y el sistema lo ignora si el `targetSdk` es 33+.
- **Android 10-12 (API 29-32)**: un solo permiso, `READ_EXTERNAL_STORAGE` (runtime, dangerous), cubre las tres colecciones de media **más** `MediaStore.Downloads`.
- Ninguno de los dos permisos existe hoy en `AndroidManifest.xml` (confirmado — el manifest actual solo declara `INTERNET`, `RECORD_AUDIO` y `com.android.alarm.permission.SET_ALARM`, `AndroidManifest.xml:1-15`) — hay que agregarlos.
- **No pude confirmar el `minSdk`/`targetSdk` reales del proyecto** — `android/app/build.gradle.kts:24-25` usa `flutter.minSdkVersion`/`flutter.targetSdkVersion` (default de la instalación de Flutter, no un valor pineado en el repo) — hay que verificarlo cuando esto se implemente, mismo criterio que ya se aplicó acá de no asumir comportamiento de plataforma sin confirmarlo (`external-actions-and-connectors-analysis.md` §6, verificación en el Samsung real antes de cerrar `phone_set_alarm`).

### 1.3 Alcance real — sé explícito sobre qué queda afuera

**Buscable sin SAF, con el permiso correspondiente otorgado:**
- Fotos y videos en cualquier carpeta pública indexada (DCIM, Pictures, Movies, carpetas de apps que vuelcan ahí como WhatsApp/cámara) — `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` (13+) o `READ_EXTERNAL_STORAGE` (10-12).
- Audio ídem, `READ_MEDIA_AUDIO`.
- Archivos de **cualquier tipo** (PDF, docx, apk, zip) que estén específicamente en `Downloads/` — pero **solo en Android 10-12**, vía `READ_EXTERNAL_STORAGE` (esa colección especial `MediaStore.Downloads` está cubierta por ese permiso). **En Android 13+ esto deja de ser cierto**: no existe ningún permiso runtime granular que destape `Downloads/` de otras apps — la única puerta es `MANAGE_EXTERNAL_STORAGE` (ver más abajo), no un `READ_MEDIA_*`.

**No buscable nunca sin abrir el picker SAF, sea cual sea el permiso otorgado:**
- Documentos sueltos en `Documents/` o cualquier carpeta pública que no sea las de media ni `Downloads/` — MediaStore no las indexa como colección propia y no hay garantía de que hayan sido escaneadas.
- Carpetas privadas de otras apps (`Android/data/<paquete>/`, `Android/obb/<paquete>/`) — bloqueadas para toda app que no sea la dueña desde Android 11, sin excepción, ni siquiera con `MANAGE_EXTERNAL_STORAGE`.
- Contenido que vive solo en un proveedor remoto no respaldado por archivo local (ej. un doc de Drive no descargado al dispositivo) — no es filesystem, hace falta la API de esa app o apuntar SAF a su `DocumentsProvider`.
- Un adjunto guardado por una app dentro de su propia carpeta privada (ej. Telegram) sin pasar por MediaStore — mismo caso que arriba.

**Opción más amplia, fuera de v1, anotada pero no recomendada como default**: `MANAGE_EXTERNAL_STORAGE` ("acceso a todos los archivos") destapa lectura de cualquier tipo en cualquier carpeta pública, incluido `Downloads/` de terceros en Android 13+. Se otorga vía pantalla de Ajustes (`Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`), no vía diálogo runtime normal — al no distribuirse esta app por Play Store, no hay review de política que lo bloquee, pero sigue siendo un permiso mucho más amplio del que hace falta para "buscar un archivo por nombre". Queda como posible v2 si el alcance de v1 (media + Downloads en 10-12) resulta insuficiente en el uso real — no lo resuelvo acá, es la misma clase de decisión producto/seguridad que este doc no debe cerrar unilateralmente.

**Conclusión honesta**: el alcance de v1 es bueno para fotos/videos/audio siempre, y para "lo que bajé recientemente" solo en Android 10-12. En Android 13+ un PDF bajado del navegador **no** va a aparecer en `phone_find_files` salvo que se sume `MANAGE_EXTERNAL_STORAGE` más adelante. Vale la pena que la `description` del tool sea honesta sobre esto (ver 2), para que el modelo no prometa una búsqueda universal que no puede cumplir.

## 2. Contrato del tool nuevo: `phone_find_files`

```jsonc
{
  "name": "phone_find_files",
  "description": "Busca archivos por nombre entre los indexados por MediaStore del teléfono (fotos, videos, audio, y en Android 10-12 también lo que esté en Downloads) SIN abrir ningún picker — el resultado vuelve directo. Alcance parcial: no ve documentos sueltos en otras carpetas ni carpetas privadas de otras apps; para elegir un archivo a mano o abrir la app de archivos, usá phone_pick_file en su lugar.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {"type": "string", "description": "Texto a buscar en el nombre del archivo (substring, no regex)."},
      "extension": {"type": "string", "description": "Filtro opcional por extensión, ej. \"pdf\" (sin el punto). No combinar con mimeType."},
      "mimeType": {"type": "string", "description": "Filtro opcional por MIME type exacto, ej. \"application/pdf\". No combinar con extension."},
      "limit": {"type": "integer", "description": "Máximo de resultados a devolver, default 25, tope 100."}
    },
    "required": ["query"]
  },
  "kind": "sync",
  "riskLevel": "safe"
}
```

**Shape del resultado** (`device.tools.result` / retorno de `DeviceToolExecutor.execute`):

```jsonc
{
  "matches": [
    {"name": "factura_octubre.pdf", "uri": "content://media/external/downloads/12345", "size": 204800, "mimeType": "application/pdf", "modifiedAt": 1767225600000}
  ],
  "total": 3,       // total de filas que matchean, antes de aplicar el límite
  "truncated": false // true si total > matches.length
}
```

`uri` es un `content://` de MediaStore (`ContentUris.withAppendedId(collection, id)`), no un path de filesystem — coherente con lo que ya devuelven `phone_search_files`/`phone_list_documents` hoy (`MainActivity.kt:285`, `:330`, siempre `uri`, nunca `DATA`/path crudo).

**`kind: "sync"`, no `"interactive"`** — es la decisión central de esta sección, justificada en detalle en 4. Resumen: el chequeo de permiso es una lectura sincrónica (`ContextCompat.checkSelfPermission`), no un diálogo que haya que esperar; si falta el permiso, el tool devuelve un error inmediato en vez de disparar la UI del sistema y bloquear la respuesta. Eso mantiene esta llamada con el mismo contrato de timeout corto que `phone_open_app`/`phone_set_alarm`, sin sumar un tercer valor de `kind` ni reabrir el mecanismo de `requestId`/progreso/cancelación que 3.3 de `phone-gateway-connectivity-design.md` reservó específicamente para UI del sistema que sí espera a un humano de forma indefinida.

**`riskLevel: "safe"`** — aplica el mismo criterio ya cerrado en `external-actions-and-connectors-analysis.md` §6-7: sin escritura persistente, sin efecto hacia terceros, y la consecuencia real de la acción (qué metadata puede ver el modelo) queda completamente contenida y explicada por el propio permiso que el usuario ya otorgó de antemano — no hay una pantalla a mitad de camino cuyo alcance sea ambiguo, como sí pasaba con el editor de calendario (§7 de ese doc). Es una lectura, mismo nivel que `phone_list_installed_apps`.

## 3. Separar "buscar" de "elegir a mano" — rename de `phone_search_files`

`phone_search_files` no cambia de comportamiento — sigue siendo el picker SAF de un solo archivo, eso ya es correcto y coincide con un pedido real ("elegí vos un archivo" / "abrí la app de archivos"). Lo que está mal es solo el nombre y la descripción, que hoy describen una búsqueda que no ocurre.

**Rename: `phone_search_files` → `phone_pick_file`.** Mismos `parameters` (`mimeType` opcional), mismo `kind: "interactive"`, mismo `riskLevel: "safe"`, mismo flujo nativo (`handlePickDocument`, `MainActivity.kt:104-120`) — cero cambio de comportamiento, solo nombre + descripción:

```jsonc
{
  "name": "phone_pick_file",
  "description": "Abre el selector de archivos del sistema (Storage Access Framework) para que el USUARIO elija manualmente un archivo. No busca nada — si el pedido es \"buscá el archivo X\", usá phone_find_files en su lugar. Usá esta solo cuando el usuario pida explícitamente elegir o abrir la app de archivos. Espera al usuario, puede tardar o cancelarse.",
  "parameters": { "...": "sin cambios" },
  "kind": "interactive",
  "riskLevel": "safe"
}
```

`phone_list_documents` (`device_tool_specs.dart:56-63`) queda **fuera de esta propuesta** — ya es explícito en su propia descripción ("abre el picker de directorio... lista no recursivo"), no miente sobre lo que hace, no hace falta tocarlo.

## 4. Gate de permiso — qué se resuelve acá y qué queda para UX

Diseño elegido: **el chequeo de permiso vive en el tool call (sincrónico), el pedido del permiso (el diálogo del sistema) NO.**

- `handleFindFiles` en Kotlin corre `ContextCompat.checkSelfPermission(...)` para el/los permiso(s) relevantes al filtro pedido (si `extension`/`mimeType` acota a un solo tipo de media, chequea solo ese; si la búsqueda es genérica, chequea el set aplicable al nivel de API corriendo). Si falta, **no** llama a `requestPermissions` ni abre ningún diálogo — devuelve de inmediato `result.error("permission_required", "READ_MEDIA_IMAGES,READ_MEDIA_VIDEO not granted", null)`.
- Esto reusa el mecanismo de forwarding que ya existe para `"cancelled_by_user"` (`MainActivity.kt:287-291`, `yggdrasil_client.dart:289-293`, comentario explícito en `device_tools_channel.dart:21-23` sobre que el mensaje se reenvía tal cual) — **cero cambio de protocolo**, el string de error ya viaja intacto hasta `device.tools.result`/el retorno de `DeviceToolExecutor.execute`, y de ahí el modelo puede narrarlo ("no tengo permiso para ver tus fotos, tenés que habilitarlo en Ajustes...") en vez de asumir erróneamente "no existe el archivo" — que es lo que pasaría si en cambio devolviera `matches: []` en silencio.
- **Por qué no pedir el permiso desde el propio handler nativo, con un callback tipo `onRequestPermissionsResult` (mismo molde que `onActivityResult` de los pickers)**: técnicamente es posible, pero mezclaría dos decisiones distintas — "¿el modelo puede ejecutar esta búsqueda ahora?" (debería ser rápido y determinístico) con "¿cuándo y con qué copy le pedimos permiso al usuario?" (una decisión de UX real: ¿se pide la primera vez que se intenta buscar, mid-turno, con el turno bloqueado esperando un tap? ¿o se ofrece antes, desde una pantalla de configuración, para que la búsqueda nunca falle por sorpresa a mitad de conversación?). Encadenar el diálogo del sistema dentro del tool call fuerza la primera opción sin haberla decidido.
- **Quién pide el permiso, entonces**: el mismo mecanismo que ya existe para el micrófono — `permission_handler` (ya es dependencia, `pubspec.yaml`) llamado desde Flutter, no desde Kotlin. `voice_mic_button.dart:59` ya hace exactamente `Permission.microphone.request()` disparado por una acción de UI, con un estado `errorPermission` que ofrece `openAppSettings()` si el usuario ya lo negó antes (`voice_mic_button.dart:52-56`). El mismo patrón aplica acá: un botón/card en algún punto de la UI (settings, o una card reactiva ante el error `permission_required` en el chat) llama `Permission.photos.request()`/`Permission.videos.request()`/`Permission.audio.request()` (o `Permission.storage.request()` en 10-12) y, si el usuario acepta, la próxima llamada a `phone_find_files` ya encuentra el permiso otorgado sin ningún cambio adicional del lado nativo.
- **Qué le llega al modelo si el usuario lo negó**: el mismo error `permission_required` — no hay forma de distinguir "nunca se preguntó" de "se preguntó y dijo que no" desde `checkSelfPermission` (Android no expone esa distinción a la app salvo `shouldShowRequestPermissionRationale`, que solo tiene sentido invocado desde una Activity en el momento de pedir, no acá). El mensaje de error puede ser el mismo en ambos casos; es la UI de Flutter (offline del tool call) la que sabe si ya preguntó antes y puede decidir mostrar "pedir permiso" vs. "andá a Ajustes" — mismo patrón que ya resuelve `voice_mic_button.dart`.
- **Dejo abierto a propósito** (coordinación con UX, pane en paralelo, según el pedido): *cuándo* se dispara la primera vez ese pedido (¿proactivo en un onboarding/settings, o reactivo recién cuando `phone_find_files` falla la primera vez?) y el copy/card exactos. Esta sección solo fija el contrato técnico (qué error código llega, quién es responsable de pedir el permiso) para que UX pueda diseñar el flujo sin tener que adivinar la interfaz con el tool.

## 5. Cambios necesarios en ambos call sites (diseño, no implementación)

Los dos puntos de ejecución (`lib/standalone/device_tool_executor.dart:40` y `lib/services/yggdrasil_client.dart:219`) leen el mismo `phoneDeviceToolSpecs` (`device_tool_specs.dart`) y por ahora despachan por nombre de tool en un `switch`/`case`. El cambio queda así:

1. **`device_tool_specs.dart`**: renombrar el bloque `"name": "phone_search_files"` (línea 44) a `"phone_pick_file"` + nueva `description` (sección 3) — `parameters`/`kind`/`riskLevel` intactos. Agregar un bloque nuevo para `"phone_find_files"` (sección 2) al lado de los existentes.
2. **`device_tools_channel.dart`**: el método `pickDocument`/`cancelPickDocument` (líneas 24-34) no cambia de firma — solo se actualiza el comentario que lo asocia a `phone_search_files` (línea 5-6) para que diga `phone_pick_file`. Se agrega un método nuevo, sin estado pendiente ni cancelación (no hay UI que cerrar):
   ```dart
   static Future<Map<String, dynamic>> findFiles({required String query, String? extension, String? mimeType, int? limit}) async {
     final result = await _channel.invokeMethod<Map>('findFiles', {'query': query, 'extension': extension, 'mimeType': mimeType, 'limit': limit});
     return Map<String, dynamic>.from(result ?? {});
   }
   ```
3. **`device_tool_executor.dart:40`** (standalone) y **`yggdrasil_client.dart:219`** (gateway): el `case 'phone_search_files':` de ambos pasa a `case 'phone_pick_file':` (mismo cuerpo, sin cambios de lógica — sigue llamando `DeviceToolsChannel.pickDocument`). Se agrega un `case 'phone_find_files':` nuevo en ambos, sin el manejo de `_interactivePending`/`onProgress`/`_pendingInteractiveRequestId` que sí usan los tools `interactive` — al ser `kind: "sync"`, es un `await DeviceToolsChannel.findFiles(...)` directo, mismo molde que `phone_set_alarm`/`phone_open_app` en esos mismos archivos.
4. **`MainActivity.kt`**: agregar un case `"findFiles"` al `when (call.method)` del `setMethodCallHandler` (línea 34-63), con un `handleFindFiles(...)` nuevo que hace el chequeo de permiso (sección 4) + la query de MediaStore (sección 1.1) + arma el resultado (sección 2). No toca `handlePickDocument`/`handleCancelPickDocument` ni `pendingPickResult` — es una función nueva e independiente, sin estado compartido con los pickers.
5. **`AndroidManifest.xml`**: agregar `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO` y `READ_EXTERNAL_STORAGE` (con `android:maxSdkVersion="32"` en este último, para que quede claro que en 33+ no es el mecanismo vigente). Primera vez que esta app declara permisos de almacenamiento/media — vale la pena que quede marcado como punto a confirmar con el usuario antes de implementar, mismo criterio que ya se sigue en este proyecto de no asumir superficie de permisos nueva sin decisión explícita.

Ningún cambio de protocolo gateway (`methods.ts`, `server.ts`) hace falta — `phone_find_files` es `kind: "sync"`, mismo camino que ya existe hoy para `phone_open_app`/`phone_set_alarm` (`phone-gateway-connectivity-design.md` §3.2), y el mapping de `riskLevel` server-side por nombre de tool (`methods.ts:155-160` según ese mismo doc) solo necesita sumar la entrada `phone_find_files → safe` y renombrar `phone_search_files → phone_pick_file` en esa tabla — un cambio server-side chico, fuera del alcance de este doc (mobile), pero que hay que coordinar con Backend antes de que el rename se despliegue (si el gateway sigue esperando el nombre viejo, `phone_pick_file` le llegaría sin mapping de riesgo conocido).

## 6. Addendum — respuesta a UX: `scopeLimited`/`uncoveredKinds` (permiso parcial, no faltante)

UX (`file-search-ux-flows.md` §4.3) planteó un caso que mi contrato original (sección 2) no cubría: **permiso parcial concedido** — el usuario otorgó, por ejemplo, `READ_MEDIA_IMAGES` pero no `READ_MEDIA_VIDEO`/`READ_MEDIA_AUDIO` (el diálogo de Android 13+ deja tildar cada tipo por separado). Ahí `handleFindFiles` **no** debe fallar con `permission_required` — corre la query igual, y solo tiene que avisar que parte del universo buscable quedó afuera. Propuso dos formas y pidió que yo elija cuál cierra mejor:

**Decisión: flag adjunto (opción 1 de UX), no un `status` dedicado — pero acotando qué entra en `uncoveredKinds`.**

- **Por qué el flag y no `partial_scope` como status nuevo**: un status mutuamente excluyente pierde la distinción que UX ya identificó bien — "encontré 2 fotos pero no busqué en video" y "no encontré nada y tampoco busqué en video" son dos redacciones distintas del modelo, y colapsarlas en un solo status obliga a decidir de antemano cuál gana. El flag conserva `matches`/`total`/`truncated` intactos y le suma el dato de cobertura como una dimensión aparte — más barato de leer para el modelo (dos campos booleanos/array, no un enum nuevo que aprender) y más barato de implementar nativo (ya se calcula solo con los mismos `checkSelfPermission` que el gate de la sección 4 corre igual).
- **Corrección real a lo que UX propuso — `uncoveredKinds` NO debe incluir `"documents"/"pdf"/"other"`.** Esos tipos están **siempre** fuera de alcance en v1 (sección 1.3 — ni con todos los permisos de media otorgados se destapan; hace falta `MANAGE_EXTERNAL_STORAGE`, fuera de v1). Marcar eso en cada respuesta individual es ruido: es un límite **estático** de la herramienta, no algo que cambie de una llamada a la otra — y ya está dicho una sola vez, de forma permanente, en la propia `description` del tool (sección 2: "no ve documentos sueltos en otras carpetas..."). Repetirlo como flag en cada resultado banaliza la señal justo cuando sí importa: el caso real y dinámico es el de permisos de media otorgados a medias, que **sí** puede cambiar entre una llamada y la siguiente (el usuario puede ir a Ajustes y sumar `READ_MEDIA_VIDEO` a mitad de sesión).
- **`uncoveredKinds` queda acotado a `["images","video","audio"]`** — solo los tres tipos que el propio v1 puede pedir permiso y que por ende pueden pasar de no-otorgado a otorgado dentro de la misma sesión. Se computa igual que el chequeo de la sección 4 (mismos tres `checkSelfPermission`), sin costo adicional real.
- Shape final, agregado a los tres resultados que UX señaló (`ok`/`empty`/`truncated`, nunca reemplaza esos campos):
  ```jsonc
  {
    "matches": [ /* ... */ ],
    "total": 2,
    "truncated": false,
    "scopeLimited": true,
    "uncoveredKinds": ["video", "audio"]  // solo subconjunto de images/video/audio; nunca documents/pdf/other
  }
  ```
  `scopeLimited` ausente (no `false`) cuando los tres permisos de media están otorgados — evita que el modelo tenga que distinguir "false explícito" de "no aplica", mismo criterio que ya usan los campos opcionales existentes (`label` en `phone_set_alarm`, etc.).

## 7. `MANAGE_EXTERNAL_STORAGE` — acceso ampliado opcional (confirmado por el usuario, cierra los 6 puntos pedidos)

Cambia lo que decía §1.3/§6 del resumen original ("v2, no recomendado como default, no lo resuelvo acá"): el usuario confirmó que quiere este permiso disponible como opción de ampliación, no solo anotado. Esto **no reemplaza** nada de §1/§2/§4/§6 — es una capa adicional por encima del flujo de permisos granulares, que sigue existiendo igual para quien no lo otorgue.

### 7.1 Detección — incremental, no reemplaza el chequeo existente (punto 1)

**Confirmado: incremental.** `Environment.isExternalStorageManager()` (API 30+, requiere guardar el chequeo con `Build.VERSION.SDK_INT >= Build.VERSION_CODES.R` dado que no está confirmado el `minSdk` real — mismo punto abierto de §1.2) se chequea **primero**, como un short-circuit:

```kotlin
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()) {
    // acceso total — se saltea por completo el chequeo granular de §4 (READ_MEDIA_*/READ_EXTERNAL_STORAGE)
} else {
    // fallback: el chequeo granular existente de §4, sin cambios
}
```

Esto es coherente con el comportamiento real de la plataforma, no una decisión de diseño arbitraria: según la documentación de Android, una app con "All Files Access" concedido **no necesita además** `READ_EXTERNAL_STORAGE` ni los `READ_MEDIA_*` — `MANAGE_EXTERNAL_STORAGE` los subsume para lectura. El gate de §4 (`checkSelfPermission` por tipo) sigue existiendo tal cual para el caso — que va a seguir siendo el más común — de que el usuario no lo haya otorgado.

### 7.2 Cómo se entera la app de que se otorgó (punto 2)

**Confirmado: sin callback especial, detección lazy en el próximo tool call — mismo patrón que el resto del gate de §4.** `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` abre una pantalla de Ajustes del sistema, no un flujo de permiso runtime — aunque se lance con `startActivityForResult`, el `resultCode` que vuelve **no** indica si el usuario otorgó o no el permiso (a diferencia de `onRequestPermissionsResult` para permisos dangerous normales, que sí trae el resultado). No hay nada que capturar en `onActivityResult` de `MainActivity.kt` para este caso — la próxima vez que corra `phone_find_files`, `handleFindFiles` vuelve a llamar `isExternalStorageManager()` (síncrono, sin costo) y ahí se entera solo, igual que ya pasa con los permisos granulares tras volver de `permission_handler.request()` (§4).

Quién dispara el pedido: mismo split que ya cerró §4 — `permission_handler` desde Flutter (`Permission.manageExternalStorage.request()`, que el propio paquete ya mapea a ese intent de Ajustes), no código nativo nuevo en `MainActivity.kt` para pedirlo.

### 7.3 Campo nuevo en el envelope — DISTINTO de `scopeLimited` (punto 3)

`scopeLimited`/`uncoveredKinds` (§6) señalan permiso de **media parcial** (algunas fotos/video/audio sí, otras no) — no aplica acá. Esto es un eje distinto: **"hay una puerta más ancha disponible y no se abrió"**, relevante incluso cuando la búsqueda actual encontró todo lo que puede encontrar en su alcance actual.

Nombre elegido: **`broaderAccessAvailable`** — booleano, presente **solo cuando `MANAGE_EXTERNAL_STORAGE` NO está otorgado** (mismo criterio de ausencia-como-default que `scopeLimited`, §6). No lleva un array tipo `uncoveredKinds` porque no hay nada que particionar — es un único permiso todo-o-nada, no tres tipos independientes.

```jsonc
{
  "matches": [ /* lo que sea que encontró en el alcance actual */ ],
  "total": 1,
  "truncated": false,
  "broaderAccessAvailable": true   // ausente si MANAGE_EXTERNAL_STORAGE ya está otorgado, o si no hace falta (todo lo pedido ya se encontró y no hay indicio de que buscaba fuera de media)
}
```

Igual que con `scopeLimited`, no intento inferir del `query` si el usuario "quería" un documento — se adjunta siempre que el permiso no esté otorgado, sea cual sea el resultado (mismo criterio que ya usa §6: más simple que adivinar intención desde el string de búsqueda). El modelo decide si vale la pena mencionarlo según el contexto de la conversación.

Puede coexistir con `scopeLimited` en la misma respuesta (son ejes independientes — permiso de media parcial + permiso ampliado no otorgado, ambos a la vez, son un estado válido).

### 7.4 Query ampliada cuando está otorgado (punto 4)

**Lo que NO hace falta cambiar**: la query de `MediaStore.Files` de §1.1 no lleva ningún filtro de tipo escrito a mano — es el propio sistema operativo el que restringe qué filas devuelve según los permisos otorgados. Con `MANAGE_EXTERNAL_STORAGE` concedido, la **misma query**, sin tocar una línea, empieza a devolver filas que antes el SO ocultaba (PDFs, `.docx`, `.zip`, en cualquier carpeta pública, no solo `Downloads/`).

**Matiz real que agrego acá, no pedido explícitamente pero relevante para que "todos los archivos" sea honesto**: `MediaStore.Files` solo conoce lo que el escáner de medios **ya indexó** — un archivo recién copiado a una carpeta pública por otra app puede no aparecer todavía ahí, con o sin `MANAGE_EXTERNAL_STORAGE`, porque el índice no depende del permiso sino de si corrió el escaneo. `MANAGE_EXTERNAL_STORAGE` también habilita acceso directo por `java.io.File`/`Files.walk(...)` sobre el almacenamiento compartido, que **no** depende del índice de MediaStore y sí vería ese archivo. Recomiendo (no soy quien decide performance/alcance final, lo dejo marcado): cuando `isExternalStorageManager()` es `true` **y** la búsqueda pide algo fuera de media (`extension`/`mimeType` no-media, o búsqueda genérica), complementar la query de MediaStore con un recorrido de filesystem acotado (excluyendo `Android/data`/`Android/obb`, bloqueados igual — §1.3) — con límite de tiempo/directorios y usando el mismo contrato `timeout`/`partialMatches` que UX ya definió (`file-search-ux-flows.md` §5) si se corta antes de terminar. Sin esto, `MANAGE_EXTERNAL_STORAGE` amplía el permiso pero no necesariamente amplía lo que la query ve en la práctica para archivos no escaneados — vale la pena confirmarlo con una prueba real antes de dar esto por cerrado, mismo criterio de verificación en hardware que ya se aplicó en el resto de este proyecto.

**Confirmado en el Samsung real (usuario, post-implementación)**: con `MANAGE_EXTERNAL_STORAGE` otorgado, la query de `MediaStore.Files` sin cambios encontró 9 PDFs reales en `Download/` que antes daban 0 resultados — el caso común (PDFs bajados por el navegador a `Download/`) queda resuelto solo con §7.1-§7.3, sin necesitar el recorrido de filesystem del párrafo anterior. Ese recorrido queda como mitigación de un caso más angosto (archivo recién copiado por otra app a una carpeta pública, antes de que corra el próximo escaneo de medios) — no bloqueante, no verificado todavía, pero ya no es la ruta principal para que "todos los archivos" funcione en la práctica.

### 7.5 `scope` actualizado (punto 5)

El string de `scope` que usa el caso `empty` (`file-search-ux-flows.md` §2) pasa a reflejar el permiso real al momento de la búsqueda:
- `MANAGE_EXTERNAL_STORAGE` otorgado → `"todos los archivos del almacenamiento externo"`.
- Si no, el string existente sin cambios (describe el subconjunto media/Downloads real según §1.3).

### 7.6 AndroidManifest.xml (punto 6)

```xml
<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />
```

- **`tools:ignore="ScopedStorage"` — no lo agrego preventivamente.** Ese lint específico de Android Studio apunta a uso de `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` sin `maxSdkVersion` en apps con `targetSdk` alto, no está confirmado que declarar `MANAGE_EXTERNAL_STORAGE` en sí dispare esa regla — agregar un `tools:ignore` sin haber visto la advertencia real puede terminar silenciando algo distinto el día de mañana. Recomiendo compilar primero y agregar el `ignore` solo si el lint efectivamente se queja, con el mensaje exacto citado en el commit.
- **`android:requestLegacyExternalStorage` — confirmado que NO aplica.** Ese atributo es específico de Android 10 (API 29) como mecanismo de opt-out temporal de scoped storage; la propia documentación de Android dice que se ignora por completo en API 30+. Como `MANAGE_EXTERNAL_STORAGE` es justamente el mecanismo de API 30+ para el mismo problema, declarar ambos sería redundante y el segundo no tendría efecto — no agregarlo.
- El permiso convive sin conflicto con `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`/`READ_MEDIA_AUDIO`/`READ_EXTERNAL_STORAGE` de §1.2 — todos quedan declarados, el chequeo de 7.1 decide en runtime cuál camino tomar.
- Mismo punto abierto que ya señalé en §1.2: confirmar `minSdk` real del proyecto antes de implementar, para saber si hace falta o no el guard `Build.VERSION.SDK_INT >= Build.VERSION_CODES.R` (hace falta si `minSdk < 30`, que es lo más probable dado que `android/app/build.gradle.kts:24` no pinea un valor propio).

## 8. Resumen de decisiones

1. **API**: una sola query a `MediaStore.Files.getContentUri(VOLUME_EXTERNAL)` filtrando por `DISPLAY_NAME`/`MIME_TYPE` — no tres queries por colección.
2. **Permisos**: `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`/`READ_MEDIA_AUDIO` (13+) o `READ_EXTERNAL_STORAGE` (10-12, `maxSdkVersion="32"`). Nada nuevo para MediaStore propio (no aplica, la app no escribe media).
3. **Alcance real**: fotos/video/audio siempre (con permiso); "lo que bajé" solo en Android 10-12; documentos sueltos fuera de Downloads y carpetas privadas de otras apps, nunca sin SAF salvo `MANAGE_EXTERNAL_STORAGE` (§7, ahora confirmado en scope, no solo anotado).
4. **Tool nuevo**: `phone_find_files` — `{query, extension?, mimeType?, limit?}` → `{matches[], total, truncated}`, `kind: "sync"`, `riskLevel: "safe"`.
5. **Tool renombrado**: `phone_search_files` → `phone_pick_file` (mismo comportamiento, descripción honesta). `phone_list_documents` sin cambios.
6. **Gate de permiso**: chequeo sincrónico dentro del tool (`checkSelfPermission`, sin diálogo) → error `permission_required` reenviado tal cual (mismo mecanismo que `cancelled_by_user`); el pedido real del permiso (`permission_handler`, ya usado para el micrófono) queda en manos de la UI de Flutter — cuándo/cómo mostrarlo se deja abierto para UX.
7. **Call sites**: `device_tool_executor.dart` y `yggdrasil_client.dart` cambian el mismo `case` (`phone_search_files`→`phone_pick_file`) y suman el mismo `case` nuevo (`phone_find_files`) — ambos leen la única fuente de verdad (`device_tool_specs.dart`), no hay riesgo de que diverjan.
8. **Permiso parcial** (§6, en respuesta a UX): flag `scopeLimited`+`uncoveredKinds` adjunto a `ok`/`empty`/`truncated`, no un status nuevo — `uncoveredKinds` acotado a `["images","video","audio"]`, nunca a `documents`/`pdf`/`other` (eso es límite estático, ya cubierto por la `description` del tool).
9. **`MANAGE_EXTERNAL_STORAGE`** (§7): detección incremental vía `Environment.isExternalStorageManager()` (short-circuit antes del gate granular), sin callback de pedido (detección lazy en el próximo tool call, mismo patrón que el resto del gate), campo nuevo `broaderAccessAvailable` (distinto de `scopeLimited`, ausente cuando ya está otorgado), `scope` actualizado a "todos los archivos del almacenamiento externo" cuando aplica, manifest sin `requestLegacyExternalStorage` (no aplica en API 30+) y sin `tools:ignore` preventivo (agregar solo si el lint realmente se queja). **Confirmado en hardware real (2026-09-06): 9 PDFs de Download aparecieron sin necesitar el filesystem walk de respaldo (§7.4).**

---
Generado con Claude Code — sesión: https://claude.ai/code/session_01WYAisFZiCxEX1YPyCKM7P7
