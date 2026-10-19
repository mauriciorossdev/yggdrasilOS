# Plan: Acceso remoto a terminales de agentes desde el celular

## Objetivo
La app de escritorio (Electron + Node, terminales renderizadas con `xterm.js`) levanta uno o más agentes, cada uno corriendo en su propia terminal (pty). Se necesita poder ver y operar esas terminales desde una app Flutter en el celular, en tiempo real, sin duplicar lógica de agentes: el celular es un cliente delgado que solo renderiza y envía input.

## Arquitectura

```
[Electron main process]
   ├─ pty por agente (node-pty)     ──┐
   ├─ registro de sesiones activas    │
   └─ servidor WebSocket (puerto X)  ◄┘
              │
              │  wss:// (o ws:// en LAN)
              ▼
[App Flutter / Android]
   ├─ pantalla de conexión (host, puerto, token)
   ├─ pantalla lista de agentes
   └─ pantalla terminal (xterm.dart)
```

No se toca el renderizado local existente (`xterm.js` sigue funcionando igual); solo se agrega un servidor que reexpone el mismo flujo de bytes del pty.

## Fase 1 — Backend: servidor WebSocket en la app Electron

1. Agregar dependencia `ws` al proceso principal (o a un proceso hijo dedicado si se prefiere aislar).
2. Mantener (o reutilizar si ya existe) un registro `Map<agentId, ptyProcess>` de las terminales activas.
3. Levantar un `WebSocketServer` en un puerto configurable (ej. 7777), con un protocolo JSON simple sobre cada mensaje:
   - Cliente → servidor:
     - `{"type": "auth", "token": "..."}`
     - `{"type": "list"}`
     - `{"type": "attach", "agentId": "..."}`
     - `{"type": "input", "agentId": "...", "data": "..."}`
     - `{"type": "resize", "agentId": "...", "cols": 80, "rows": 24}`
     - `{"type": "detach", "agentId": "..."}`
   - Servidor → cliente:
     - `{"type": "agents", "agents": [{"id","name","status"}]}`
     - `{"type": "output", "agentId": "...", "data": "..."}`
     - `{"type": "closed", "agentId": "..."}`
     - `{"type": "error", "message": "..."}`
4. Al recibir `attach`, suscribir esa conexión a los eventos `data` del pty correspondiente (además de lo que ya escucha `xterm.js` local) y reenviarlos como `output`.
5. Al recibir `input`, escribir los bytes al `pty.write()` del agente indicado.
6. Al recibir `resize`, llamar `pty.resize(cols, rows)`.
7. Emitir `agents` cada vez que se crea/cierra un agente, y también como respuesta a `list`.

## Fase 2 — Autenticación y red

1. Generar un token (ej. UUID) al iniciar la app de escritorio y mostrarlo en la UI (o como QR) para pegarlo/escanearlo en el celular.
2. Rechazar cualquier mensaje que no sea `auth` válido antes de aceptar otros tipos.
3. Para uso fuera de la red local: documentar dos opciones (elegir una)
   - Túnel tipo Tailscale/ZeroTier (recomendado, sin exponer puertos).
   - `wss://` con certificado propio + exponer el puerto (más trabajo, más riesgo).
4. En LAN doméstica, `ws://` sin TLS es aceptable como primer paso.

## Fase 3 — App Flutter: cliente

1. Crear proyecto Flutter (o módulo dentro de uno existente).
2. Dependencias: `xterm`, `web_socket_channel`.
3. Pantalla de conexión: input de host/IP, puerto, token; guardar último usado (shared_preferences opcional).
4. Servicio `AgentSocketService`:
   - Maneja el `WebSocketChannel`, el handshake `auth`, y expone streams: `agentsStream`, y por agente un stream de `output`.
   - Métodos: `connect()`, `listAgents()`, `attach(agentId)`, `sendInput(agentId, data)`, `resize(agentId, cols, rows)`, `detach(agentId)`.
5. Pantalla lista de agentes: consume `agentsStream`, muestra nombre/estado, tap para abrir terminal.
6. Pantalla terminal:
   - Instancia un `Terminal` de `xterm.dart`.
   - Al recibir `output` del socket → `terminal.write(data)`.
   - Al recibir input del widget `TerminalView` (teclado, gestos) → `sendInput`.
   - En `onResize` del widget → `resize`.
   - Al salir de la pantalla → `detach` (no mata el agente, solo deja de escuchar).

## Fase 4 — Manejo de reconexión y background

1. Si el WebSocket se cae, reintentar conexión con backoff.
2. Al reconectar, volver a hacer `auth` + `attach` a la terminal que estaba abierta.
3. Nota: los agentes siguen corriendo en el computador aunque el celular se desconecte; el pty no depende del cliente conectado.

## Fase 5 — Pruebas

1. Local: computador y celular en la misma red Wi-Fi, `ws://IP-local:7777`.
2. Verificar: listar agentes, adjuntar, escribir input, recibir output, resize al rotar pantalla, reconexión tras cortar Wi-Fi.
3. Verificar múltiples agentes simultáneos y cambio entre pestañas/pantallas sin perder output.
4. Probar con túnel (Tailscale) fuera de la red local.

## Entregables esperados de esta implementación
- Cambios en la app Electron: servidor WS + integración con los pty existentes.
- Nueva app/módulo Flutter con las 3 pantallas descritas.
- Documentación corta de cómo generar/copiar el token y conectar desde el celular.
