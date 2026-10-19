# Propuesta corta: multi-idioma (inglés/español) en la app mobile

Estado: **propuesta, sin implementar**.
Fecha: 2026-09-05.

## 1. Alcance — confirmar antes de asumir

Esto es sobre **strings de la UI de Flutter** (labels, botones, placeholders — "Escribí un mensaje…", "Cancelar", "Guardar", etc.), configurable por el usuario, español neutro sin modismos de país.

**Esto NO incluye en qué idioma responde el LLM.** Son dos ejes distintos: la UI es texto estático que vive en el cliente (se resuelve con localización estándar de Flutter, cero relación con el modelo); el idioma de respuesta del LLM es comportamiento del modelo/prompt, típicamente ya sigue el idioma en que el usuario escribe sin necesidad de configurar nada. Si más adelante se quiere forzar el idioma de respuesta del LLM independiente de lo que el usuario tipea, es una feature separada (un knob de config/prompt), no parte de esto. **Confirmado como fuera de scope acá, no asumido.**

## 2. Qué hay hoy (leído del código, + auditoría de Frontend)

- `mobile/app/pubspec.yaml`: sin `intl`, sin `flutter_localizations`, sin ningún paquete de i18n. Sin `l10n.yaml`. Cero infraestructura de i18n, confirmado por los dos por separado.
- Todos los strings de UI están hardcodeados en español directo en los widgets (ej. `chat_screen.dart:475` `Text('Nombre del chat')`, `478` `Text('Cancelar')`, `481` `Text('Guardar')`).
- **Escala real (auditoría de Frontend, reemplaza mi estimación gruesa por grep)**: ~80 strings de usuario (`Text`/`hintText`/`labelText`/títulos de diálogo) en 12 archivos — más concentrado en `chat_list_screen.dart` (15), `profile_editor_screen.dart` (11), `profiles_screen.dart`/`settings_screen.dart`/`interactive_tool_card.dart` (~10 c/u). Nada de `showDatePicker`/`showTimePicker`/`DateFormat`/`NumberFormat` en todo `lib/` (verificado) — no hay ningún widget que dependa de que el framework traduzca su propio chrome (el "Cancel"/"OK" nativo de un date picker, por ejemplo), que es el único caso donde haría falta `flutter_localizations` sí o sí.

## 3. Mecanismo — decisión: mapa liviano, no `intl`/ARB

**Recomendación cerrada: `Map<String, Map<String, String>>` + una función `t(key)`, sin `intl`/ARB/`flutter_localizations`, sin `build_runner`/codegen.** Corrijo mi primera pasada de este mismo doc, que recomendaba ARB — con el número real (80 strings, 12 archivos, 2 idiomas fijos, nada de plurales, nada de formato de fecha/número) el balance da distinto del que asumí antes de tener el dato exacto:

- **El argumento fuerte de ARB (validación de keys en compile-time) es más débil de lo que dije.** `flutter gen-l10n` no falla el build si falta una traducción en `app_es.arb` — cae al string del idioma base y sigue, es un warning, no una garantía dura. El mapa liviano puede cubrir el mismo caso con dos líneas de test (`expect(en.keys.toSet(), equals(es.keys.toSet()))`), sin traer todo el toolchain de ARB solo para eso.
- **ICU/plurales — no hay ningún caso real hoy.** Los 80 strings son labels/botones/hints cortos, no until yo un solo caso de pluralización pendiente. Es una ventaja de ARB que hoy no se usa — no vale el costo de traerla "por si acaso".
- **No hay dependencia de `flutter_localizations` por otro motivo** (confirmado arriba: sin date/time pickers nativos, sin formato de números).
- **Costo real de ARB en este proyecto**: agregar `flutter_localizations` (SDK) + `intl`, `l10n.yaml`, reestructurar `MaterialApp` con `localizationsDelegates`/`supportedLocales`, una clase generada de por medio para cada acceso a un string. Con 2 idiomas fijos y sin plan de agregar un tercero en el corto plazo, es más aparato del que el problema pide.
- **El mapa liviano escala igual de bien a un tercer idioma el día que haga falta** — agregar una entrada más al mapa top-level no es distinto en esfuerzo a agregar un `.arb` más.

**Mitigación del único riesgo real del mapa** (que las dos traducciones se desincronicen sin que nadie lo note): un test unitario chico que compare los `keys` de `en`/`es` y falle si no coinciden — cierra la brecha de "compile-time validation" de ARB con costo mínimo, sin el resto del aparato.

**Si más adelante aparece un tercer idioma con reglas de plural reales, o el conteo de strings crece un orden de magnitud**, ahí sí re-evaluar ARB — no antes.

## 4. Selección de idioma por el usuario — mecanismo de persistencia

Sea cual sea el mecanismo de strings, hace falta guardar la preferencia del usuario (no alcanza con seguir el idioma del sistema operativo, el pedido es "configurable"). Mismo patrón ya establecido en toda la app: `SharedPreferences`, prefijo `yggdrasil_pref_` (`profile_store.dart`, `yggdrasil_client.dart`) — una key nueva, ej. `${_prefPrefix}locale` (`"en"`/`"es"`), leída al arrancar para fijar el `Locale` de `MaterialApp` antes del primer frame. No hace falta storage nuevo ni un mecanismo distinto al que ya usa el resto de la configuración persistida (perfiles, baseUrl legacy).

## 5. Español neutro — nota de contenido, no de mecanismo

El pedido de "neutro, sin modismos de país" es sobre el *contenido* de los valores en `es.arb`, no cambia nada de la sección 3. Vale la pena que quien traduzca (Frontend, con o sin ayuda de un LLM para la primera pasada) tenga esto como criterio explícito de revisión — ej. evitar "vos"/"tú" marcados regionalmente si se puede formular neutro ("escribe un mensaje" en vez de forzar una de las dos formas cuando el imperativo neutro alcanza), evitar términos de una sola región para conceptos comunes. No amerita más análisis de mi parte, es un criterio editorial para quien escriba los strings, no una decisión de arquitectura.

## 6. Resumen / próximo paso

1. Inventario de strings ya cerrado por Frontend (80 strings, 12 archivos, sección 2).
2. Dos archivos de traducciones (`en`/`es`) + función `t(key)` — sin dependencia nueva, sin codegen.
3. Reemplazar los literales hardcodeados por `t('key')` (o el nombre que Frontend prefiera para la función/import).
4. Test unitario chico que valide que `en`/`es` tengan las mismas keys (mitigación de drift, sección 3).
5. Selector de idioma en `SettingsScreen`, sección "Personalización" (al lado de "Tu nombre", según Frontend — cero navegación nueva) + persistencia vía `SharedPreferences`, key `${_prefPrefix}locale` (sección 4).
6. Traducciones en español revisadas contra el criterio de neutralidad (sección 5).

Nada de esto se implementa todavía — queda a la espera de que el usuario dé el visto bueno.

---
Generado con Claude Code — sesión: https://claude.ai/code/session_0116JqfBKympUw3Xhmr2ZVu4
