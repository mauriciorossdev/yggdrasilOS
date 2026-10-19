# Desplegar el gateway de workflows en Railway

Despliega **solo el gateway headless** (`yggdrasil gateway`, sin Electron),
para correr workflows en la nube. Ver `Dockerfile` (raíz del repo) para el
detalle de qué se buildea y por qué.

**Este mismo servicio también aloja al asistente personal de la app mobile**
(chat único con memoria, documentos, calendario, recordatorios y push): ver
la sección "Asistente personal" al final y `notes/asistente-personal/diseno.md`.
La imagen se construyó y se probó en vivo en Railway (build, volumen, WebSocket,
Anthropic, FCM). Los **workflows** siguen sin probarse en vivo — ver "Gaps
conocidos / sin probar".

## Qué funciona ahí y qué no

✅ Triggers por schedule/webhook/evento, `http.request`, lógica
(if/switch/loop/delay/set), y el motor de runs/grants/historial completo.

❌ Nodos `desktop.*` (abrir apps, screenshot, notify) y `phone.*` — no hay
pantalla ni celular real atados a una caja de Railway. Un workflow que los
use va a fallar ahí (no silenciosamente — debería dar error de "no
provider/adapter registrado", pero no lo confirmamos en vivo).

⚠️ `agent.ask` — depende de qué harness/provider configures el workflow.
Si usa un provider OpenAI-compatible (`OPENAI_API_KEY`/`OLLAMA_API_KEY`/
`providers.openai-compat.apiKey`), debería andar seteando el env var
correspondiente. Si el workflow fue armado para usar el harness `claude`
(el CLI real, como vimos en Agent Flow y en el flujo de Chat de hoy), ESE
camino no está configurado en esta imagen (no instalamos el CLI `claude`
ni su auth) — sin confirmar todavía cuál usa `agent.ask` por default en
este contexto no-interactivo. Primer punto a verificar cuando probemos.

## 1. Crear el proyecto en Railway

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub
   repo → elegí este repo. Railway detecta `railway.toml` solo (build con
   el `Dockerfile` de la raíz).
2. **Agregá un Volume** (Railway dashboard → tu servicio → Volumes → New
   Volume) montado en `/data`. Ahí vive `/data/project` — el workspace del
   workflow (config, definiciones, estado de runs/grants/artifacts). Sin
   esto, cada redeploy borra todo.

## 2. Variables de entorno

En el dashboard del servicio, pestaña Variables:

| Variable | Para qué | Obligatoria |
|---|---|---|
| `YGGDRASIL_API_KEY` | Auth del gateway (WS/HTTP) — la URL va a ser pública, **no la dejes sin esto**. El cliente que se conecte manda `{method:"auth", params:{apiKey}}` o `?apiKey=` en la query. | Sí |
| `ANTHROPIC_API_KEY` | Provider `anthropic` (`packages/provider-anthropic`): el agente `assistant` y, con él, la compactación de sesiones. | Para el asistente |
| `REPLICATE_API_TOKEN` | Voz (TTS) del asistente: MiniMax `speech-2.8-turbo` vía Replicate (`tts.synthesize`). Opcional: `REPLICATE_TTS_MODEL`, `REPLICATE_TTS_VOICE`. | Solo si usas voz |
| `FCM_SERVICE_ACCOUNT_JSON` | JSON completo (una línea) de la cuenta de servicio de Firebase: push, recordatorios con la app cerrada. Debe ser del mismo proyecto que el `google-services.json` de la app. | Solo si usas push |
| `OPENAI_API_KEY` / `OLLAMA_API_KEY` | Providers OpenAI-compatibles, p. ej. para nodos `agent.ask` de workflows. Ver limitación arriba. | Si el workflow lo usa |
| `YGGDRASIL_WORKSPACE` | Default `/data/project` (ya seteado por `docker-entrypoint.sh`) — normalmente no hace falta tocarlo. | No |

`PORT` lo inyecta Railway solo — `docker-entrypoint.sh` lo mapea a
`YGGDRASIL_GATEWAY_PORT` automáticamente, no lo seteés a mano.

## 3. Subir las definiciones del workflow

No hay UI de edición ahí (es headless) — las definiciones
(`.yggdrasil/workflows/<id>.json`, mismo formato que usa la app desktop)
tienen que llegar al volumen por fuera. Más simple para un primer test:

```bash
railway link                      # conecta la CLI local al proyecto
railway run sh                    # shell dentro del contenedor desplegado
# ahí adentro: cat > /data/project/.yggdrasil/workflows/mi-workflow.json <<'EOF'
# { ...definición exportada desde la app desktop... }
# EOF
```

(O `railway ssh` si tu plan lo soporta — pegá el JSON del workflow que ya
armaste y probaste localmente con `ygg-qa-tooling`.)

## 4. Probar

```bash
curl https://<tu-servicio>.up.railway.app/hooks/workflows/<id> \
  -H "Authorization: Bearer <secreto-del-workflow>" \
  -X POST -d '{}'
```

El workflow necesita `settings.allowRemoteTrigger: true` y un trigger de
tipo webhook con su `secretRef` — mismo modelo de permisos que ya documenta
`notes/automation/workflows-design.md` (preflight: schema → trigger
permitido → grant válido → target online → permisos OS).

## Gaps conocidos / sin probar

- **Nunca se construyó esta imagen** — el Dockerfile es correcto según el
  código leído (`cmdGateway()` en `packages/cli/src/index.ts`,
  `resolvePluginSearchPathsAsync` en `packages/kernel/src/plugin-loader.ts`
  para el truco de `plugins.load.paths`), pero puede haber un paquete que
  no compile standalone fuera del contexto completo del monorepo, o una
  dependencia nativa sin prebuild para la plataforma de Railway.
- **No hay endpoint `/health`** — confirmado por grep en
  `packages/gateway/src/server.ts`, no inventé uno. `railway.toml` no
  define `healthcheckPath` a propósito; Railway cae al chequeo TCP default.
- **`agent.ask` sin confirmar** qué harness toma en este contexto
  (ver tabla de arriba).
- El build completo del monorepo (`pnpm --filter './packages/**'
  --filter './extensions/**' --filter '!@yggdrasil/app-desktop' -r run
  build`) puede ser lento/pesado — no medido todavía. Candidato a
  optimizar con multi-stage + `pnpm deploy --prod` una vez que esto arranque
  al menos una vez.
- Grants (`workflows.grant`) hoy solo los puede otorgar una conexión
  **loopback** (`isLoopbackConnection`, `packages/gateway/src/methods.ts`)
  — en un gateway remoto no hay loopback real salvo que te conectes desde
  DENTRO del contenedor (`railway run`). Un workflow con nodos riesgosos
  sin grant previo (otorgado localmente antes de subir la definición, o
  vía `railway run`) no va a poder correr ahí. No evaluamos todavía cómo
  se siente este flujo en la práctica.

## Asistente personal (app mobile)

El gateway de esta imagen es también el backend del asistente de la app mobile
(`mobile/app`, id `com.mauriciorossdev.yggdrasil`). Diseño completo y estado de
las fases: `notes/asistente-personal/diseno.md`.

**Qué hay del lado del servidor**
- Agente `assistant` definido en `project-template/yggdrasil.config.json`
  (Haiku 4.5, prompt largo para activar el prompt caching, lista de tools
  permitidas, proveedor de memoria).
- Sesión única `assistant:main`, memoria (sqlite), documentos subidos desde el
  teléfono (`notes/assistant`), recordatorios, cola de acciones offline y
  tokens de push — todo en el volumen `/data` (ver `diseno.md` para las rutas).
- RPC propios: `documents.*`, `memory.*`, `push.*`, `tts.synthesize`.

**Desplegar cambios**
```bash
railway link                 # una vez, proyecto yggdrasil-assistant
railway up --detach          # sube la carpeta local y reconstruye (~4 min)
railway service status       # BUILDING -> DEPLOYING -> SUCCESS
```
(O push a la rama conectada: Railway construye desde GitHub.) La config del
proyecto se **resincroniza desde la plantilla en cada arranque**; pon
`YGGDRASIL_KEEP_CONFIG=1` si quieres editarla a mano en el volumen.

**Push (FCM) — requisitos**
1. `google-services.json` de la app en `mobile/app/android/app/` (mismo
   `package_name` que el `applicationId`).
2. Habilitar la API **Firebase Cloud Messaging API (V1)** (`fcm.googleapis.com`)
   en el proyecto de Google Cloud; si no, el envío falla con 403
   `SERVICE_DISABLED`.
3. Variable `FCM_SERVICE_ACCOUNT_JSON` en Railway.
4. Comprobar: RPC `push.status` → `configured: true, devices: 1`; `push.test`
   → `sent: 1`.

**Lecciones del primer despliegue (ya aplicadas en el `Dockerfile`)**
- Fijar pnpm (`corepack prepare pnpm@10.33.2`): sin versión, corepack baja un
  major nuevo que ignora los build scripts (`ERR_PNPM_IGNORED_BUILDS`).
- `better-sqlite3` va en `pnpm.onlyBuiltDependencies`, y se instala **sin**
  `app-desktop`, cuyo postinstall lo recompila para Electron y rompe el binario
  de Node.
- Las sesiones se guardan en el volumen (`sessions.dir` en la plantilla); en el
  disco del contenedor se perdían en cada redeploy.
- No existe `/health`; Railway usa el chequeo TCP por defecto.
