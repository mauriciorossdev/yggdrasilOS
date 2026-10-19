# UX: Configuración → Capacidades (prender/apagar qué puede hacer el modelo en el teléfono)

Estado: **propuesta de flujo, sin implementar.** Responde puntualmente el punto que Architect dejó abierto en `phone-find-files-design.md` §4 ("cuándo/cómo se dispara el pedido de permiso... se deja abierto para UX") sumándole una pantalla nueva de control explícito, no solo el flujo reactivo ya cerrado en `file-search-ux-flows.md` §4. Dos decisiones técnicas quedan explícitamente abiertas para Architect (dónde vive el estado on/off, y si apagar saca la tool de la lista o la deja fallar con mensaje) — ver §6. No toco código.
Basado en: `settings-consolidation-proposal.md` §1.1 (estructura del menú de Configuración, ya implementada) + `phone-find-files-design.md` (contrato de los tools, `riskLevel`/`kind` por tool) + `home-screen-voice-input-ux.md` (patrón de permiso lazy + `errorPermission`/"Abrir ajustes" ya usado para el mic, mismo paquete `permission_handler`) + `file-search-ux-flows.md` §4 (flujo reactivo de permiso ya cerrado, esto lo complementa, no lo reemplaza).

---

## 0. Por qué hace falta esto

Hoy los 8 `phone_*` tools (`device_tool_specs.dart`) están todos disponibles siempre que el modelo quiera usarlos — el único control que tiene el usuario es el approval gate por `riskLevel` (`mobile-chat-ux-flows.md` §4), que para los `safe` (la mayoría) ni siquiera se muestra. Con `phone_find_files` sumando lectura real de MediaStore (fotos/video/audio/lo bajado reciente, `phone-find-files-design.md` §1.3) — y `MANAGE_EXTERNAL_STORAGE` como acceso ampliado opcional, **ya confirmado en v1, validado en el Samsung real** (`phone-find-files-design.md` §7, encontró PDFs en `Downloads/` que antes daban 0 resultados) —, tiene sentido darle al usuario un control explícito y visible de **qué categorías de acción tiene habilitadas el modelo**, más allá del permiso de Android en sí — dos capas de control distintas, no una reemplaza a la otra (ver §3).

No es una feature de privacidad estricta obligatoria — es la misma lógica de "Personalización"/"Configuración de agente" que ya existe: darle al usuario un lugar visible para entender y ajustar qué puede hacer la app, en vez de que sea un comportamiento implícito que solo se nota cuando ya pasó.

---

## 1. Dónde vive en la navegación

Nueva fila **"Capacidades"** en el menú de Configuración (`settings-consolidation-proposal.md` §1.1), entre "Configuración de agente" y "Perfiles de conexión":

```
┌───────────────────────────────┐
│ ← Configuración                │
├───────────────────────────────┤
│ Personalización                 │
│ Alex                           │
├───────────────────────────────┤
│ Conexión activa                │
│ Mi PC de casa                  │
├───────────────────────────────┤
│ Configuración de agente         │  ← condicional, sin cambios
│ Anthropic (Claude) · sonnet-5   │
├───────────────────────────────┤
│ Capacidades                     │  ← NUEVO
│ 7 de 8 activas                  │     preview: cuántas están ON
├───────────────────────────────┤
│ Perfiles de conexión            │
│ 2 guardados · Mi PC de casa     │
└───────────────────────────────┘
```

- **Siempre visible, no condicional** (a diferencia de "Configuración de agente") — los `phone_*` tools corren en modo `gateway` y en modo `direct`/standalone por igual (`remote-access-analysis.md` §7.2, mismo `phoneDeviceToolSpecs` en los dos call sites, `phone-find-files-design.md` §5), así que el control tiene sentido en cualquier modo de conexión.
- El subtítulo ("N de M activas") le da al usuario una señal de estado sin tener que entrar — mismo criterio que "Conexión activa" ya muestra su dato relevante en la fila del menú, sin obligar a abrir la pantalla para saber qué hay.
- Los conectores cloud (Google Calendar/Gmail, `external-actions-and-connectors-analysis.md`) **no** entran acá — ya tienen su propio mecanismo de "Conectar/Desconectar Google" en Settings (PROJECT-LOG.md, ítem 5). Meterlos en la misma pantalla mezclaría dos sistemas distintos (capacidad local on/off vs. cuenta externa vinculada), el mismo tipo de conflación que `settings-consolidation-proposal.md` §0 ya identificó y separó para "perfil de conexión" vs. "identidad de usuario" — mismo criterio aplicado de nuevo acá.

---

## 2. Pantalla "Capacidades" — layout

Agrupada por categoría, no una lista plana de 8 filas sin criterio — hace más fácil entender qué se está prendiendo/apagando de un vistazo:

```
┌───────────────────────────────────────┐
│ ← Capacidades                          │
├───────────────────────────────────────┤
│ Apps                                    │
│ ┌─────────────────────────────────┐    │
│ │ Abrir apps                 [ON] │    │  phone_open_app
│ │ Abrir apps instaladas del cel   │    │
│ ├─────────────────────────────────┤    │
│ │ Listar apps                [ON] │    │  phone_list_installed_apps
│ │ Ver qué apps tenés instaladas   │    │
│ └─────────────────────────────────┘    │
├───────────────────────────────────────┤
│ Archivos                                │
│ ┌─────────────────────────────────┐    │
│ │ Buscar archivos            [ON] │    │  phone_find_files
│ │ Buscar por nombre en fotos,     │    │
│ │ videos, audio y descargas       │    │
│ │ 🔒 Necesita permiso de Android  │    │  ← badge condicional, ver §3
│ ├─────────────────────────────────┤    │
│ │ Elegir archivo a mano       [ON]│    │  phone_pick_file
│ │ Abrir el selector de archivos   │    │
│ ├─────────────────────────────────┤    │
│ │ Elegir carpeta a mano       [ON]│    │  phone_list_documents
│ │ Abrir el selector de carpetas   │    │
│ └─────────────────────────────────┘    │
├───────────────────────────────────────┤
│ Recordatorios                           │
│ ┌─────────────────────────────────┐    │
│ │ Alarmas                     [ON]│    │  phone_set_alarm
│ ├─────────────────────────────────┤    │
│ │ Temporizador                [ON]│    │  phone_set_timer
│ ├─────────────────────────────────┤    │
│ │ Eventos de calendario   [OFF]  │    │  phone_add_calendar_event
│ └─────────────────────────────────┘    │
└───────────────────────────────────────┘
```

- Cada fila: nombre corto en criollo (no el nombre técnico del tool) + descripción de una línea + `Switch`. El nombre técnico (`phone_find_files`, etc.) no se muestra en la UI — es un detalle de protocolo, no algo que el usuario necesite ver, mismo criterio que ya se sigue en el resto de la app (las tool-cards del chat tampoco muestran el nombre crudo del tool, `mobile-chat-ux-flows.md` §3).
- **Default: todas en ON** al instalar — el comportamiento de hoy (todo disponible) sigue siendo el default; esta pantalla es para restringir, no un opt-in que deje la app inútil hasta que el usuario configure algo. (Asunción de producto, no técnica — confirmable con el usuario si prefiere lo contrario antes de implementar.)
- Sin agrupar por `riskLevel` (`safe`/`moderate`) — el approval gate de `mobile-chat-ux-flows.md` §4 ya es el control por riesgo; esta pantalla es un control distinto (categoría/tipo de acción), mezclar los dos criterios en la misma agrupación confundiría cuál pantalla resuelve qué.

---

## 3. El toggle NO es lo mismo que el permiso de Android — dos capas

Esto es la aclaración central de todo el doc, porque es fácil confundirlas:

- **Capa 1 — el toggle de esta pantalla**: intención del usuario sobre la app ("quiero que el modelo pueda hacer esto"). Vive en Yggdrasil, no en Android.
- **Capa 2 — el permiso runtime de Android** (`READ_MEDIA_IMAGES`/etc., solo aplica a `phone_find_files` de los 8 — ningún otro tool de la lista pide permiso runtime: `phone_open_app`/`phone_list_installed_apps` no lo necesitan, `phone_pick_file`/`phone_list_documents` son SAF y tampoco, `phone_set_alarm`/`phone_set_timer`/`phone_add_calendar_event` delegan a la app nativa correspondiente sin pedir permiso propio). Vive en el sistema operativo, ya diseñado en `file-search-ux-flows.md` §4.

**Las dos tienen que estar en "sí" para que `phone_find_files` funcione.** El badge `🔒 Necesita permiso de Android` en la fila (§2) solo aparece cuando el toggle está ON pero Android todavía no otorgó el permiso — es una señal, no un bloqueo: el toggle puede estar ON con el permiso pendiente (mismo estado que hoy, antes de este doc, cuando el usuario nunca usó la búsqueda todavía). Ninguna otra fila necesita este badge, porque ninguna otra depende de un permiso runtime de Android.

---

## 4. Prender `phone_find_files` desde esta pantalla — resuelve el punto abierto de Architect

`phone-find-files-design.md` §4 dejó abierto explícitamente "¿proactivo en un onboarding/settings, o reactivo recién cuando falla la primera vez?". Respuesta: **los dos, según el punto de entrada, con el mismo mecanismo de fondo (`permission_handler`, ya usado para el mic)**:

- **Desde esta pantalla (proactivo)**: tocar el switch de "Buscar archivos" para pasarlo a ON dispara `Permission.photos/videos/audio.request()` en el momento, ahí mismo — el usuario ya está en un contexto explícito de configuración, pedir el permiso ahí no es una sorpresa a mitad de conversación.
  ```
  toca switch ON
        │
        ▼
  diálogo nativo de Android (system UI)
        │
        ├── Permitido → switch queda ON, badge 🔒 desaparece
        │
        └── Denegado → switch VUELVE a OFF automáticamente (no
            queda en un ON-pero-roto) + texto breve bajo la fila:
            "Sin permiso no puedo buscar archivos" +
            [Abrir ajustes] si permission_handler.status ya da
            permanentlyDenied (mismo criterio que voice_mic_button.dart,
            errorPermission)
  ```
- **Desde el chat (reactivo)**: si el toggle ya está ON (default) pero el permiso de Android nunca se pidió, la primera búsqueda real dispara el flujo ya cerrado en `file-search-ux-flows.md` §4.1 — lazy, al primer fallo, sin que el usuario haya tenido que pasar por Configuración. Esta pantalla no reemplaza ese flujo, es una segunda puerta de entrada al mismo pedido de permiso, para quien prefiera configurar todo de antemano en vez de encontrarse el pedido en medio de una conversación.
- Apagar el switch **nunca** toca el permiso de Android — desactivar la capacidad en Yggdrasil no revoca nada a nivel de sistema, el permiso queda como estaba (el usuario podría reactivar el switch después sin que Android vuelva a preguntar, si ya lo había concedido antes).

---

## 5. Apagar una capacidad — sin confirmación, con copy claro

**Sin modal de confirmación al apagar** — mismo criterio ya usado para cancelar el picker SAF (`mobile-chat-ux-flows.md` §5.2: "cancelar es de bajo costo/reversible, agregar fricción ahí es peor UX que un apagado accidental ocasional"). Prender de nuevo el switch es inmediato y sin costo.

Qué pasa si el modelo intenta usar una capacidad apagada — acá es donde la decisión técnica de Architect (§6) cambia el flujo real, pero en los dos casos el usuario en el chat debería terminar viendo algo equivalente:

*"No puedo [buscar archivos / abrir apps / poner una alarma] porque tenés esa función apagada. Podés prenderla en Configuración → Capacidades."*

---

## 6. Abierto para Architect — las dos decisiones técnicas que dependen de esto

**No diseño el mecanismo interno de estas dos, solo el flujo de usuario para cada rama posible, para no bloquear la pantalla de arriba mientras se decide:**

### 6.1 Dónde vive el estado on/off

Opciones sin resolver acá: `SharedPreferences` local (por dispositivo, no viaja con el perfil de conexión — coherente con que hoy `userName`/idioma también son locales, `settings-consolidation-proposal.md`/`mobile-i18n-proposal.md`), vs. algo que el gateway conozca (para que un mismo usuario vea el mismo estado entre dispositivos, si eso llega a importar). Para efectos de este doc asumo **local**, por ser lo más simple y consistente con el resto de Settings — si Architect decide que debe sincronizarse con el gateway, la pantalla de arriba no cambia, solo cambia de dónde lee/escribe el switch.

### 6.2 Apagado = tool desaparece de la lista, vs. tool sigue registrada y falla con mensaje

- **Opción A — desaparece**: `device.tools.register` (gateway) / la lista que arma `device_tool_executor.dart` (standalone) simplemente **no incluye** el spec de esa tool cuando está OFF. El modelo nunca sabe que existe.
  - Riesgo real de esta opción: si el usuario pide "buscá el archivo X" con la capacidad apagada, el modelo no tiene ninguna señal de que la función existe pero está apagada — puede terminar diciendo "no tengo esa función" en vez de "está desactivada, prendela en Configuración", que es una respuesta peor y menos accionable. Para que el copy de §5 funcione bajo esta opción, hace falta darle al modelo ese dato por otra vía (ej. una nota en el system prompt tipo "el usuario tiene desactivada la búsqueda de archivos") — no es gratis, es trabajo adicional de prompting que esta opción exige y la opción B no.
- **Opción B — sigue registrada, falla con mensaje**: la tool sigue en la lista que ve el modelo, pero al invocarla el tool call devuelve de inmediato un error tipo `capability_disabled` — mismo mecanismo de forwarding ya usado para `permission_required`/`cancelled_by_user` (`phone-find-files-design.md` §4, cero protocolo nuevo). El modelo recibe el error, puede narrar el copy exacto de §5 sin necesitar ningún dato extra fuera de banda.
  - Costo de esta opción: la tool "existe" para el modelo aunque esté apagada — si la preocupación de fondo es puramente de privacidad/superficie (que el modelo ni sepa que la capacidad existe), esto no la resuelve tan a fondo como la opción A. Pero no ejecuta ningún código nativo real — el error es inmediato, antes de tocar MediaStore/Intent alguno.

**Mi lectura desde UX, sin ser quien cierra la decisión**: la opción B da una experiencia conversacional más clara (el modelo puede guiar al usuario al lugar exacto) con el mismo nivel de privacidad efectiva (nada se ejecuta), así que si no hay una razón técnica de peso para la A, B parece la default más simple — pero es date de Architect confirmar si hay algo (costo de mantener specs "fantasma", o el objetivo explícito de que el modelo no deba ni enterarse de la existencia de la capacidad) que incline para el otro lado.

Cuando Architect cierre 6.1/6.2, este doc no necesita rediseño — la pantalla de §2, el badge de §3 y el copy de §4/§5 no cambian con ninguna de las dos ramas, solo el mecanismo interno que las produce.

---

## 7. Addendum — `MANAGE_EXTERNAL_STORAGE` validado en hardware, corrige §4 para ese caso puntual

`phone-find-files-design.md` §7 confirmó (y el usuario validó en el Samsung real, PDFs de `Downloads/` que antes daban 0) que `MANAGE_EXTERNAL_STORAGE` está en v1 como acceso ampliado opcional para `phone_find_files` — no es un permiso más de la lista granular (`READ_MEDIA_*`), es un tercer nivel por encima. Esto **no cambia** el toggle principal de "Buscar archivos" en §2 (sigue siendo un solo switch ON/OFF, la capacidad como tal), pero sí cambia cómo se pide *ese* acceso ampliado específicamente — el diagrama de §4 (diálogo runtime simple → granted/denied sincrónico) **no aplica** a este permiso puntual:

- `MANAGE_EXTERNAL_STORAGE` se otorga vía `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` — una pantalla completa de Ajustes del sistema, no un diálogo. Android **no devuelve un resultado** al volver de esa pantalla (a diferencia de `permission_handler.request()` para `READ_MEDIA_*`, que sí resuelve granted/denied al toque) — la app recién se entera en el próximo `phone_find_files` real (detección lazy, `phone-find-files-design.md` §7.2).
- Consecuencia para la fila "Buscar archivos" en §2: agrega una **acción secundaria**, no un segundo switch — un link/botón bajo la fila, algo como *"Ampliar acceso (ver también documentos, no solo fotos/video/audio)"*, visible solo cuando el toggle principal está ON. Tocarlo abre directo la pantalla de Ajustes de Android (sin paso intermedio de la app). **Al volver, no mostrar ningún resultado inmediato** — nada de "✓ Permitido" ni "✕ Denegado" en el momento, porque la app no lo sabe todavía. El estado real (badge de §3) se actualiza recién la próxima vez que el modelo efectivamente busque algo y el `broaderAccessAvailable` del resultado (`file-search-ux-flows.md` §4.4) confirme si quedó otorgado o no.
- Evitar el error de diseñar esto como si fuera un tercer estado de switch (ON/OFF/ampliado) — es un botón de "ir a pedir más", no un control de estado por sí mismo; el estado real vive en Android, la fila solo ofrece el atajo para ir a pedirlo y, de forma pasiva, refleja lo último que se supo (vía el mismo `broaderAccessAvailable` que ya ve el modelo).
