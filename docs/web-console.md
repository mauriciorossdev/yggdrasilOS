# Web Console

Consola web embebida en el gateway de Yggdrasil.

## Acceso

Tras `pnpm build` y arrancar el gateway:

```bash
node packages/cli/dist/index.js gateway
# Abrir http://127.0.0.1:18789/ui
```

El CLI imprime `Console: http://127.0.0.1:18789/ui`.

## Desarrollo frontend

```bash
# Terminal 1 — gateway
node packages/cli/dist/index.js gateway

# Terminal 2 — Vite dev server (proxy WS opcional)
pnpm --filter @yggdrasil/web-console dev
```

En producción el bundle vive en `packages/gateway/ui/` (copiado al hacer `build` de `@yggdrasil/web-console`).

## Autenticación

Si `auth.gateway.required` está activo, la UI pide API key al entrar. La clave se guarda en `sessionStorage` (solo uso local / red de confianza).

Equivalente CLI:

```json
{
  "auth": {
    "gateway": { "apiKey": "dev-secret", "required": true }
  }
}
```

## Pantallas

| Ruta | Descripción |
|------|-------------|
| `/ui/` | Overview — health, plugins, harnesses, providers, channels |
| `/ui/chat` | Chat con streaming (`chat.delta` / `chat.final`) |
| `/ui/sessions` | Listar, ver, renombrar y resetear sesiones |
| `/ui/settings` | Editar agente, modelo, harness policy, canales on/off |

## Configuración desde UI

`Settings` llama `config.patch` (whitelist: `agents`, `defaultAgent`, `harness`, `channels`). Los secretos (`auth`, API keys) no se editan desde el browser.

Tras guardar, **reinicia el gateway** para aplicar cambios de harness y canales.

## RPC nuevos

| Método | Descripción |
|--------|-------------|
| `config.get` | Config sanitizada + `workspaceRoot` + `configPath` |
| `config.patch` | Escribe `yggdrasil.config.json` (campos permitidos) |

`health` incluye `authRequired`, `ui: true`, versión `0.5.0`.

## Limitaciones v1

- Sin `plugin install` desde UI
- Sin hot-reload de config
- API key en `sessionStorage` (no para producción expuesta a internet)
