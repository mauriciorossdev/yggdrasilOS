# Diseño técnico: Configuración → Capacidades (on/off por tool)

Estado: **diseño, sin implementar** — a pedido explícito del usuario. Cierra las 2 decisiones que UX dejó abiertas en `capabilities-settings-ux.md` §6.1/§6.2. No toco código.
Basado en: `capabilities-settings-ux.md` (flujo/pantalla ya cerrados, §6 son los 2 puntos que este doc resuelve) + lectura del código actual (`lib/services/device_tool_specs.dart`, `lib/services/yggdrasil_client.dart`, `lib/standalone/device_tool_executor.dart`, `lib/standalone/standalone_chat_engine.dart`, `lib/services/user_name_store.dart`, `lib/services/locale_store.dart`, `lib/profiles/profile_store.dart`, `lib/chat/settings_screen.dart`) + decisiones ya cerradas en `mobile-chat-ux-flows.md` §4 (approval card) y `remote-access-analysis.md` §7.2 (gate local de standalone) y `phone-find-files-design.md` §4 (convención de error-string forwarding).
Fecha: 2026-09-06.

## 0. Los 8 tools y los 3 call sites reales

`device_tool_specs.dart:22-133` — un único `const List<Map<String,dynamic>> phoneDeviceToolSpecs`, 8 entradas (`phone_open_app`, `phone_list_installed_apps`, `phone_pick_file`, `phone_find_files`, `phone_list_documents` en `safe`; `phone_set_alarm`, `phone_set_timer`, `phone_add_calendar_event` en `moderate`).

Ese mismo const lo consumen **tres** lugares, no dos — el pedido nombraba `device_tool_specs.dart`/`device_tool_executor.dart`/`yggdrasil_client.dart`, pero hay un tercero que importa igual y que el diseño tiene que cubrir para no dejar un hueco:

1. **`yggdrasil_client.dart:174`** — `call("device.tools.register", {"tools": _deviceTools})`, gateway mode, arma qué tools **existen para el modelo** del lado servidor.
2. **`standalone_chat_engine.dart:83`** — `toolSpecs: phoneDeviceToolSpecs` pasado directo al `ProviderClient.chat(...)`, standalone mode, arma qué tools **existen para el modelo** del lado directo-a-proveedor. Este es el que el pedido original no nombró — es el equivalente standalone de `device.tools.register`, y si no se filtra acá el modelo standalone seguiría viendo tools "apagadas".
3. **Los dos switches de ejecución** — `device_tool_executor.dart:34` (standalone) y `yggdrasil_client.dart:211` (`_handleDeviceToolInvoke`, gateway) — despachan por nombre una vez que el modelo ya decidió llamar al tool.

Import extra: `standalone_chat_engine.dart:33-39` también lee `phoneDeviceToolSpecs` para `_riskLevelFor` (el gate local de `moderate` — `remote-access-analysis.md` §7.2), que dispara `onConfirmModerateAction` (línea 103, un diálogo de confirmación) **antes** de `executor.execute()` (línea 121). Este dato es la clave de la decisión de §3.

## 1. Dónde vive el estado on/off (§6.1 de UX)

**Local (`SharedPreferences`), un único key JSON, granularidad por tool individual — no por categoría.**

- **Por qué por tool y no por categoría**: la propia pantalla de UX (`capabilities-settings-ux.md` §2) ya muestra switches independientes dentro de una misma categoría — "Abrir apps" y "Listar apps" son dos filas separadas bajo "Apps", cada una con su propio `Switch`. Si el estado viviera por categoría, esas dos filas no podrían tener valores distintos y la UI que UX ya diseñó dejaría de tener sentido. La categoría es agrupación visual (§2 de UX), no la unidad de control.
- **Por qué local y no sincronizado con el gateway**: mismo criterio que UX ya asumió en su §6.1 y que coincide con el resto de Settings — `userName` (`user_name_store.dart`) e idioma (`locale_store.dart`) son locales, por dispositivo, sin replicar al servidor. Un usuario con el cel y una tablet podría querer capacidades distintas en cada uno (ej. sin `phone_add_calendar_event` en un dispositivo que no es el suyo principal) — sincronizar impondría un único estado global que nadie pidió. Si más adelante hace falta que viaje con el perfil de conexión, el cambio queda contenido a la clase de storage de abajo (la pantalla y los call sites de §4 no cambian, mismo punto que UX ya dejó anotado).
- **Shape — sigue el patrón ya establecido en `profile_store.dart:10-12` (`ProfileStore`, un solo key con una lista serializada como JSON), no 8 keys sueltas tipo `UserNameStore`/`LocaleStore`** (esos son valores escalares únicos, no una colección — no es el patrón que aplica acá):

  ```dart
  // lib/services/capabilities_store.dart
  class CapabilitiesStore {
    static const _prefPrefix = 'yggdrasil_pref_';
    static const _key = '${_prefPrefix}capabilities';

    static Future<Map<String, dynamic>> _readAll() async { /* jsonDecode del string guardado, {} si no hay nada */ }

    /// Default true cuando el tool nunca fue tocado — mismo criterio de
    /// UX §2 ("default: todas en ON al instalar") sin necesitar escribir
    /// las 8 entradas de antemano ni migrar nada cuando se agregue un 9no tool.
    static Future<bool> isEnabled(String toolName) async => (await _readAll())[toolName] as bool? ?? true;

    static Future<void> setEnabled(String toolName, bool enabled) async { /* merge + jsonEncode + setString, mismo patrón que ProfileStore._saveAll */ }

    /// Conveniencia para la pantalla de Settings — un solo read para
    /// pintar las 8 filas en vez de 8 awaits sueltos.
    static Future<Map<String, bool>> allStates(List<String> toolNames) async {
      final raw = await _readAll();
      return {for (final name in toolNames) name: raw[name] as bool? ?? true};
    }
  }
  ```

  Guardar solo lo que el usuario efectivamente tocó (no las 8 claves desde el principio) significa que un tool nuevo agregado a futuro aparece ON automáticamente sin necesitar una migración — coherente con "el default es todo prendido, esta pantalla es para restringir" (UX §2).

## 2. Relación con el permiso real de Android (punto 2 del pedido)

Dos ejes independientes, ya identificados por UX en su §3 — acá defino qué produce cada combinación. Aplica en la práctica solo a `phone_find_files` (el único de los 8 con permiso runtime real, UX §3 ya lo señaló: los otros 7 no piden permiso de Android bajo ningún concepto).

| Toggle app (Capacidades) | Permiso Android | Resultado |
|---|---|---|
| ON | Otorgado | `phone_find_files` corre normal — resultado real, con `scopeLimited`/`broaderAccessAvailable` si aplica (`phone-find-files-design.md` §6-7). |
| ON | No otorgado | El tool sigue **anunciado** al modelo (la app permite la capacidad) pero la ejecución falla con `permission_required` — comportamiento ya cerrado en `phone-find-files-design.md` §4, sin cambios acá. Es la capa Android la que bloquea, no la capa app. |
| OFF | Otorgado | El tool **no aparece** en la lista que ve el modelo (§3 de este doc) — el permiso de Android sigue vigente pero irrelevante mientras la app no ofrezca la capacidad. Si el usuario vuelve a prender el switch, Android **no** vuelve a preguntar (ya estaba otorgado) — coherente con UX §4, último bullet ("apagar el switch nunca toca el permiso de Android"). |
| OFF | No otorgado | El tool no aparece; no se dispara ningún chequeo/pedido de permiso — la capa app ya cortó antes de que el permiso llegue a importar. |

Ninguna combinación revoca el permiso de Android desde la app — coherente con UX §4 y con que Android no expone una API para que una app de terceros revoque sus propios permisos concedidos (solo el usuario puede hacerlo desde Ajustes del sistema).

## 3. Apagado: ¿desaparece de la lista, o sigue registrado y falla? (§6.2 de UX) — decisión: **Opción A**

UX se inclinó por B (más simple, mejor narrativa conversacional) pero dejó la puerta abierta a que hubiera "algo técnico" que inclinara para el otro lado. Lo hay, y es el motivo por el que cierro en A:

### 3.1 El requisito del pedido — "la desactivación va antes que el chequeo de riesgo" — no es alcanzable con B en modo gateway

En modo gateway, el approval card **no la decide el teléfono** — la orquesta el gateway: emite `tool.approval.requested` (mapeando `riskLevel` server-side por nombre de tool, `phone-gateway-connectivity-design.md` sección de approval) y **recién después** de que el usuario aprueba manda `device.tool.invoke.requested` (`mobile-chat-ux-flows.md` §4: "el approval ocurre *antes* de mandar el invoke"). Con la Opción B (el tool sigue registrado tal cual), el gateway no tiene ninguna manera de saber que ese tool está apagado en este dispositivo puntual — va a iniciar el flujo de approval igual para cualquier tool `moderate` (`phone_set_alarm`/`phone_set_timer`/`phone_add_calendar_event`), y el teléfono recién podría detectar "está apagado" **después** de que la approval card ya se mostró y el usuario ya la resolvió. Eso es exactamente lo que el pedido pide evitar.

Arreglarlo bajo B en modo gateway exigiría que el teléfono le avise al gateway "este tool está registrado pero apagado" (un campo nuevo en `device.tools.register`) y que el gateway aprenda a saltear su propio flujo de approval para ese caso — cambio de protocolo real, cross-team con Backend, para replicar en el servidor un estado que hoy vive 100% local en el teléfono (§1). No hay atajo limpio.

En modo **standalone** sí sería alcanzable con B sin problema — el gate de riesgo (`standalone_chat_engine.dart:103`) corre en el mismo proceso, así que un chequeo de "¿está apagado?" puesto **antes** de esa línea cumple el orden pedido sin tocar nada más. Pero tener B en standalone y A en gateway para el mismo concepto de "capacidad apagada" significa dos semánticas distintas según el modo — justo el tipo de divergencia que `device_tool_specs.dart:1-8` (comentario del propio archivo) dice explícitamente que se quiere evitar ("Kept in one place specifically so the two call sites can't drift apart"). No vale la pena introducirla por la ganancia conversacional de B.

**Decisión: Opción A en los dos modos — el tool desaparece del array que ve el modelo, filtrado en el mismo lugar para gateway y standalone (§4).**

### 3.2 Mitigando el costo real que UX señaló (el modelo no sabe que la capacidad existe)

UX tiene razón en que esto es un costo real, no lo descarto. Mitigación barata, sin inventar mecanismo nuevo: cuando haya al menos una capacidad apagada, agregar una nota corta al contexto de sistema que el modelo sí recibe, sin necesidad de que la tool exista en su lista de tools:

```
"El usuario desactivó estas funciones del teléfono: Buscar archivos. Si te las
piden, avisá que están apagadas en Configuración → Capacidades — no digas que
no existen."
```

- **Dónde conectarlo — dos puntos, uno por modo, ambos fuera de mi alcance para cerrar sin ver esos archivos**:
  - Standalone: `standalone_chat_engine.dart` le manda a `_client.chat(...)` (`providers/provider_client.dart`) `history`/`toolSpecs` — no está confirmado si ese cliente ya acepta un system prompt separado de la historia o si hay que sumarlo como primer mensaje de `history`. Falta confirmar con quien mantiene `providers/`.
  - Gateway: `sendMessage()` (`yggdrasil_client.dart:312-332`) ya manda parámetros extra sueltos en `chat.send` (`agentId`/`provider`/`model`) — un campo más (`deviceCapabilitiesNote` o similar) seguiría el mismo patrón del lado cliente, pero que el gateway lo pliegue al system prompt real es trabajo de Backend, no algo que se resuelva solo con este cambio en mobile. Mismo tipo de coordinación cross-team que ya quedó anotada en `phone-find-files-design.md` §5 para el rename de tool.
- Esta nota es la respuesta a la objeción de UX, no una decisión final de copy/UX — el texto exacto y si hace falta traducirlo (`AppStrings`) queda para UX si quiere ajustarlo.

## 4. Cambios de diseño en los archivos reales (sin implementar)

1. **`lib/services/capabilities_store.dart`** (nuevo) — `CapabilitiesStore` de §1.
2. **`device_tool_specs.dart`**: agregar, al lado del `const phoneDeviceToolSpecs` existente (que se mantiene intacto como catálogo completo — es la fuente de verdad de qué tools existen, la capa de "cuáles están prendidas" va aparte), una función nueva:
   ```dart
   Future<List<Map<String, dynamic>>> enabledDeviceToolSpecs() async {
     final out = <Map<String, dynamic>>[];
     for (final spec in phoneDeviceToolSpecs) {
       if (await CapabilitiesStore.isEnabled(spec['name'] as String)) out.add(spec);
     }
     return out;
   }
   ```
   8 lecturas de `SharedPreferences` (una por tool) por llamada — costo despreciable, y `SharedPreferences.getInstance()` ya cachea la instancia entre llamadas.
3. **`yggdrasil_client.dart:174`**: `call("device.tools.register", {"tools": await enabledDeviceToolSpecs()})` en vez de `_deviceTools`. Se agrega un método público nuevo, `refreshRegisteredTools()`, que re-envía `device.tools.register` con la lista recién filtrada — la pantalla de Capacidades lo llama después de cada toggle si hay una conexión gateway activa, para que el cambio aplique sin necesidad de reconectar (`device.tools.register` ya está diseñado para poder llamarse más de una vez por conexión, `phone-gateway-connectivity-design.md` §3.1: "Vencen al desconectar (re-register al reconectar)" no dice que sea connect-only). En modo standalone no hace falta un equivalente — `standalone_chat_engine.dart` arma `toolSpecs` de nuevo en cada iteración del loop (punto 4 de abajo), así que el próximo mensaje ya ve el cambio sin ningún paso extra.
4. **`standalone_chat_engine.dart:83`**: `toolSpecs: await enabledDeviceToolSpecs()` en vez de `phoneDeviceToolSpecs` directo — recalculado en cada llamada a `_client.chat(...)` dentro del loop (línea 79), así que un toggle a mitad de conversación aplica desde el próximo turno sin lógica adicional.
5. **Defense-in-depth en los 3 puntos de ejecución** (no debería activarse nunca en el flujo normal, dado que el modelo ya no puede pedir un tool apagado bajo la Opción A — cubre solo el caso borde de un toggle justo entre que el modelo decidió llamar al tool y que se ejecuta, o una lista de tools cacheada/vieja):
   - `device_tool_executor.dart:34` (standalone) — primera línea del `execute()`: si `!(await CapabilitiesStore.isEnabled(name))`, lanzar `PlatformException(code: 'capability_disabled', message: 'capability_disabled')` — mismo mecanismo de forwarding que `cancelled_by_user`/`permission_required` (`phone-find-files-design.md` §4), cero protocolo nuevo.
   - `standalone_chat_engine.dart` — el mismo chequeo puesto **antes** de la línea 103 (`_riskLevelFor`), para que ni siquiera dispare `onConfirmModerateAction` en ese caso borde — es la aplicación literal de "la desactivación va antes que el chequeo de riesgo" a nivel de código, no solo a nivel de lo que el modelo puede pedir.
   - `yggdrasil_client.dart:211` (`_handleDeviceToolInvoke`) — mismo chequeo al principio, antes del `switch`, devolviendo `device.tools.result` con `ok:false, error:"capability_disabled"` (mismo shape que el catch de `PlatformException` que ya existe ahí, líneas 289-293).
6. **Pantalla nueva** (`lib/chat/capabilities_screen.dart`, siguiendo el mismo patrón de push que `ConfigPage`/`GoogleConnectorScreen` en `settings_screen.dart:212/220`) — layout/copy ya cerrados por UX (`capabilities-settings-ux.md` §2), lee/escribe vía `CapabilitiesStore.allStates(...)`/`setEnabled(...)`, y para `phone_find_files` específicamente cruza además el estado real de `permission_handler` para el badge 🔒 de UX §3 (ya diseñado ahí, no lo repito acá).

Ningún cambio de protocolo gateway hace falta para nada de esto — `device.tools.register` ya acepta ser llamado con cualquier subconjunto, y `capability_disabled` reusa el canal de error ya existente. Lo único que sí necesita a Backend (fuera del alcance de este doc mobile) es la nota de mitigación de §3.2, si se decide implementarla.

## 5. Resumen — respuesta directa a §6.1/§6.2 de UX

- **§6.1 (dónde vive el estado)**: local, `SharedPreferences`, un solo key JSON (`yggdrasil_pref_capabilities`) con granularidad por tool individual — mismo patrón de storage que `ProfileStore` (lista/mapa serializado bajo un key), no el patrón escalar de `UserNameStore`/`LocaleStore`. Default `true` (activa) cuando el tool nunca fue tocado.
- **§6.2 (desaparece vs. falla con mensaje)**: **Opción A (desaparece)** — no por preferencia de diseño sino porque es la única que cumple "la desactivación va antes que el approval" en modo gateway sin cambiar el protocolo del gateway; Opción B sería alcanzable en standalone pero introduciría una divergencia de comportamiento entre modos que este proyecto ya decidió evitar (`device_tool_specs.dart` como única fuente compartida). El costo que señaló UX (el modelo no sabe que la capacidad existe) se mitiga con una nota de sistema corta cuando hay capacidades apagadas (§3.2) — a nivel de diseño, no soy quien cierra el plumbing exacto en `providers/`/gateway, lo dejo marcado para quien los mantenga.
- El resto de la pantalla de UX (§2, §3 badge, §4 flujo de permiso, §5 copy) no cambia con esta decisión — como UX ya anticipó, ninguna de las dos ramas técnicas altera lo que el usuario ve.

---
Generado con Claude Code — sesión: https://claude.ai/code/session_01WYAisFZiCxEX1YPyCKM7P7
