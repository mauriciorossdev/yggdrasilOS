# Enlace desktop ⇄ teléfono vía Railway (sin escribir IP, puerto ni clave)

Estado: **DISEÑO PARA VALIDAR**. No se ha tocado código.

## Objetivo

Al abrir Yggdrasil desktop, su gateway queda **publicado en el gateway de Railway**; la app mobile lo descubre ahí y crea el perfil sola. Más adelante, un **túnel** hace que funcione desde cualquier red, sin VPN.

Decisiones del usuario: alcance **A ahora y B después**; debe funcionar **sin VPN** (hace falta B); el primer enlace de la app con Railway es por **QR mostrado en el desktop**.

## Lo que hay hoy (según el código)

- Cada proyecto del desktop lanza su propio gateway (`packages/app-desktop/src/main/gateway.ts`) en un **puerto aleatorio distinto en cada arranque**, escuchando en `0.0.0.0`.
- Solo conoce su IP de red local (`getLanAddress()`, usada para el título de la ventana). No detecta Tailscale.
- **No tiene clave por defecto**: está abierto a cualquiera en la red (`validateGatewayApiKey` devuelve true si no hay claves).
- Ya existe un registro de gateways abiertos (`openGateways.ts`) con solo el puerto.
- En la app, los perfiles (`mobile/app/lib/profiles/`) solo se crean a mano. No hay QR, mDNS ni descubrimiento. `app_links` ya está cableado en `main.dart`.
- `packages/sync-server` es otra cosa (compartir contenido entre personas); no se reutiliza.

## Arquitectura

```
Desktop (Electron)                 Railway (gateway "hub")               Teléfono
  gateway por proyecto               registro de escritorios               pantalla "Escritorios"
  + clave propia obligatoria  ──►    desktops.register / list   ◄──        descubre y crea el perfil
  publica {nombre, puerto,           (misma API key del gateway)           reintenta con el registro
  IP local, IP Tailscale}                                                   si el puerto cambió
        ▲                                                                       │
        └──────────── Fase B: túnel saliente desktop→Railway ◄── el teléfono habla solo con Railway
```

El **hub es el gateway de Railway que ya existe** (mismo servicio, misma `YGGDRASIL_API_KEY`): solo se le añade un registro. No hay servicio nuevo que desplegar.

## Fases

### E1 — Registro en el hub (servidor)
- Módulo `packages/gateway/src/assistant/desktops.ts` (junto a push/recordatorios): guarda en el volumen `desktops.json`.
- RPC `desktops.register {desktopId, name, projects:[{id,name,port}], endpoints:{lan, tailscale}, gatewayKey}` (upsert + `lastSeen`), `desktops.list` (con `online` = visto en los últimos 90 s), `desktops.remove`.
- Expiración de registros viejos; límites de tamaño; tests.

### E2 — Publicación desde el desktop
- **Clave propia del gateway**: el desktop genera una clave aleatoria, la guarda en `desktop-settings.json` y la exige a todos los gateways de proyecto (variable `YGGDRASIL_API_KEY` al lanzar el hijo). *Riesgo a verificar*: el cliente del propio Electron debe seguir conectando (clave o exención de loopback).
- Ajustes del desktop → sección "Teléfono": URL y clave del hub (se escriben **una vez** aquí), interruptor "Publicar en Railway" y botón **Mostrar QR**.
- Publicador en el proceso principal: registra al arrancar, al abrir/cerrar un proyecto y cada 60 s (heartbeat); detecta IP Tailscale (interfaz `100.x`) además de la local; se da de baja al cerrar.
- El QR codifica `yggdrasil://hub?url=…&key=…` (la clave del hub es secreto: el QR solo se muestra al pulsar y hay que poder rotarla).

### E3 — App mobile
- Dependencia de lector de QR (`mobile_scanner`, pide cámara) + handler del enlace `yggdrasil://hub` (también sirve si se abre el enlace sin QR).
- Escanear → crea/actualiza el perfil de Railway (el del asistente) y guarda el hub.
- Pantalla **"Escritorios"** (desde Perfiles): lista lo que devuelve `desktops.list` (nombre, proyectos, en línea / sin conexión). Tocar un proyecto crea el perfil `gateway` con la URL y clave publicadas y lo activa.
- Resolución de alcance: prueba los candidatos en orden (Tailscale → red local) con un apretón de manos WebSocket de ~3 s; si ninguno responde, avisa "no alcanzable desde esta red" (la Fase B lo resuelve).
- **Autorrefresco**: un perfil nacido del hub guarda `desktopId/projectId`; si la conexión falla (puerto nuevo tras reiniciar el desktop), consulta el hub y actualiza la URL sin intervención.

### B — Túnel (después)
- El desktop abre **una conexión saliente** a Railway (`/tunnel`, autenticada) y la mantiene.
- El teléfono se conecta solo a Railway: `tunnel.open {desktopId, projectId}`; el hub reenvía los mensajes JSON-RPC al desktop por esa conexión (multiplexados por canal) y el desktop los entrega a su gateway local en `127.0.0.1:puerto`, devolviendo las respuestas y eventos.
- Resuelve NAT, cambios de red y falta de VPN; la clave del gateway del desktop sigue siendo obligatoria extremo a extremo.
- A cuidar: reconexión, contrapresión con payloads grandes (archivos), tiempo de espera de cada canal.

## Seguridad

- El gateway del desktop **deja de estar abierto**: clave obligatoria siempre que se publique.
- El hub guarda las claves de los gateways de escritorio en el volumen (texto plano en `desktops.json`, igual que ya viven tus claves en variables de Railway). Se acepta porque el hub es tuyo y está protegido por su clave.
- La clave del hub viaja en el QR: mostrarlo bajo demanda, no persistir la imagen, y permitir rotarla (cambiar `YGGDRASIL_API_KEY` en Railway y volver a escanear).
- Sin tunel, un gateway de desktop solo es alcanzable desde la red local o Tailscale, no desde internet.

## Decisiones abiertas

1. **Cliente del propio Electron con clave obligatoria**: comprobar cómo se conecta hoy el renderer a su gateway; si no manda clave, se le pasa la misma o se exime loopback.
2. **Varios desktops**: se identifica cada uno por un `desktopId` estable y el nombre del equipo; si hay dos con el mismo nombre se desambigua en la lista.
3. **Datos sensibles en el hub**: no se publican rutas de archivos, solo nombre de proyecto.

## Cómo se verificará

- E1: tests del registro (alta, actualización, caducidad, límites) y prueba por script contra Railway simulando un desktop.
- E2: tests de la lógica de publicación (detección de IP, latido, baja) y prueba real abriendo el desktop.
- E3: tests de la selección de candidatos y del autorrefresco; prueba en el teléfono con el QR.
- B: pruebas de reenvío con dos extremos simulados y luego de punta a punta.

## Orden de entrega propuesto

E1 → E2 → E3 (el directorio completo funciona en la misma red / Tailscale) → B (sin VPN). Cada fase se valida antes de pasar a la siguiente.
