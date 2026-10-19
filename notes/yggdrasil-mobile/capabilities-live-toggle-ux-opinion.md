# UX: ¿aceptar parpadeo controlado al aplicar un toggle de Capacidades en caliente?

Estado: **opinión de UX a pedido explícito, no cierra nada — decisión final es de Architect.** Nota honesta sobre cómo llegué a esto: el pedido original llegó cortado dos veces en esta sesión (paste truncado) y el pane de Architect quedó ilegible en el momento (buffer con artifacts). Reconstruyo el tema a partir de: (a) lo que sí se leyó bien ("tu parte es la ingeniería del streaming, no el visual" dicho a Architect) y (b) el diseño técnico ya cerrado en `capabilities-settings-design.md`, que resuelve el mecanismo real de aplicación en caliente. Si el "parpadeo" en cuestión es otro (no el que identifico en §1), avisame y ajusto — el análisis de trade-off de §2 igual sirve de base.
Basado en: `capabilities-settings-design.md` §1/§3/§4 (mecanismo real de aplicar el toggle) + `capabilities-settings-ux.md` (pantalla/flujo ya cerrados, esto no los reabre) + `mobile-chat-ux-flows.md` §3 (estados terminales de una `SyncToolCard`).

---

## 0. Lo que ya está resuelto (no es esto lo que hay que decidir)

`capabilities-settings-design.md` §4 punto 3 ya cerró que el toggle aplica **sin reconectar el WebSocket** — `refreshRegisteredTools()` re-envía `device.tools.register` con la lista filtrada sobre la conexión existente (`device.tools.register` no es connect-only, `phone-gateway-connectivity-design.md` §3.1). En standalone ni siquiera hace falta ese paso: `standalone_chat_engine.dart` arma `toolSpecs` de nuevo en cada iteración del loop, así que el próximo turno ya ve el cambio solo. **No hay reconexión de red visible, no hay un "Reconectando..." en el chat.** Si la pregunta original era sobre eso, ya está resuelto y no hace falta parpadeo de ningún tipo.

Lo que sí queda como zona gris de UX son dos momentos puntuales, más chicos, donde algo *podría* parpadear — son los que trato acá.

---

## 1. Los dos lugares reales donde puede haber algo visible

### 1.1 El switch de la pantalla de Capacidades, en modo gateway

Tocar el switch dispara `refreshRegisteredTools()` (RPC al gateway) en background. Pregunta real de UX: ¿el switch se mueve **al toque** (optimista) o espera la confirmación del RPC antes de moverse?

- **Optimista** (mi recomendación): el switch se mueve apenas se toca, como cualquier `Switch` estándar de Android/iOS — es el comportamiento que el usuario espera de un toggle, en cualquier app. El RPC corre atrás. **Si falla** (gateway desconectado, timeout) — ahí sí, el switch **vuelve** a su posición anterior + un `SnackBar` breve: *"No se pudo actualizar — revisá la conexión e intentá de nuevo."* Ese es el "parpadeo controlado": en el caso infrecuente de fallo de red, el usuario ve el switch moverse dos veces (ida y vuelta) en vez de una.
- **Alternativa sin parpadeo**: esperar la confirmación del RPC antes de mover el switch — nunca hay ida-y-vuelta visible, pero el switch se siente con lag en el caso normal (éxito), que es el 99% de las veces. Mismo problema que un botón que no responde al toque hasta que termina una llamada de red — mala sensación táctil por defecto, para evitar un parpadeo que solo pasa cuando algo ya salió mal.

**Mi opinión**: acepto el parpadeo controlado acá. Es estrictamente mejor UX en el caso común (instantáneo) a costa de un evento raro (fallo de red) que de todos modos necesita comunicarse — el usuario tiene que enterarse si su cambio no se guardó, con o sin parpadeo. El parpadeo no es un costo nuevo, es un efecto secundario visible de comunicar ese fallo de la forma más directa (el propio switch volviendo), en vez de un modal o un ícono de error aparte.

### 1.2 Una tool-card en curso justo cuando se apaga la capacidad (edge case de milisegundos)

`capabilities-settings-design.md` §4 punto 5 ya diseñó el defense-in-depth: si el modelo llega a pedir un tool ya apagado (ventana de carrera entre que el modelo decide llamarlo y que se ejecuta), falla con `capability_disabled` — mismo mecanismo de forwarding que `permission_required`/`cancelled_by_user` (`phone-find-files-design.md` §4). Visualmente, eso es una `SyncToolCard` (`mobile-chat-ux-flows.md` §3) que pasa de "⏳ Buscando..." a un estado de error, como cualquier otro fallo sync — no es un estado nuevo que diseñar.

**Mi opinión**: tampoco necesita tratamiento especial. Es una ventana de milisegundos, el resultado visual es indistinguible de cualquier otro error de tool ya contemplado, y el usuario que justo apagó el switch mientras el modelo estaba a mitad de una búsqueda entiende razonablemente "se cortó porque lo apagué" sin necesitar un mensaje distinto al genérico de error.

---

## 2. Dónde trazo el límite (lo que SÍ me preocuparía)

Acepto parpadeo en los dos puntos de arriba porque quedan contenidos a: (a) un control de Settings, fuera del historial de chat, y (b) una tool-card resolviendo a un estado terminal único (nunca cambia dos veces después de mostrado). **Lo que rompería el modelo mental del usuario y no aceptaría** es cualquier parpadeo que toque el *historial* de la conversación después de mostrado — un mensaje que cambia de contenido, una tool-card que aparece y después desaparece del scroll, o un texto que el usuario ya leyó y se corrige solo. Nada de lo que Architect diseñó en `capabilities-settings-design.md` llega a eso — el error `capability_disabled` se muestra una vez, como estado final, igual que cualquier otro error de tool ya diseñado.

---

## 3. Resumen

- **Switch de Capacidades**: optimista al toque, revierte + `SnackBar` solo si el RPC falla — parpadeo aceptado, es mejor que esperar confirmación en el caso común.
- **Tool-card en curso durante el apagado**: se resuelve como error normal, sin diseño especial — parpadeo aceptado, es indistinguible de cualquier otro fallo ya contemplado.
- **Lo no negociable para mí**: ningún parpadeo debe tocar un mensaje ya renderizado en el historial — ninguna de las dos ramas de arriba lo hace, así que no hay conflicto con el diseño actual.
- No es decisión final mía — si Architect prefiere blindar 1.1 esperando confirmación del RPC antes de mover el switch, no rompe nada de `capabilities-settings-ux.md` (sigue siendo el mismo switch, mismo lugar) — es puramente un matiz de latencia percibida, no de flujo.
