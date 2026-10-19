# Instalación desde npm

Guía para usar Yggdrasil **sin clonar el monorepo**.

## Requisitos

- Node.js **≥ 22**
- `pnpm` o `npm`

## Proyecto nuevo

```bash
mkdir my-agent && cd my-agent
pnpm init
pnpm add @yggdrasil/cli
npx yggdrasil init
```

`yggdrasil init` crea:

- `yggdrasil.config.json` — agente, gateway, canales
- `extensions/` — plugins locales (opcional)

## Instalar un plugin

```bash
npx yggdrasil plugin install @yggdrasil/tool-weather
```

Esto ejecuta `pnpm add` / `npm install` y añade el id del plugin a `plugins.installed` en tu config.

## Arrancar

```bash
export OLLAMA_API_KEY=...   # o OPENAI_API_KEY
npx yggdrasil tui
# o headless:
npx yggdrasil gateway
```

## CLI global

```bash
npm install -g @yggdrasil/cli
yggdrasil init
yggdrasil plugin install @yggdrasil/tool-weather
yggdrasil run
```

## Workspace root

El CLI resuelve el directorio del proyecto así:

1. Variable de entorno `YGGDRASIL_WORKSPACE`
2. Carpeta que contiene `yggdrasil.config.json` (busca hacia arriba desde `cwd`)
3. `cwd` actual

Ejecuta los comandos desde tu proyecto o define `YGGDRASIL_WORKSPACE=/ruta/al/proyecto`.

## Comandos `plugin`

| Comando | Descripción |
|---------|-------------|
| `yggdrasil plugin list` | Plugins en `plugins.installed` y su estado |
| `yggdrasil plugin install <pkg>` | Instala paquete npm y habilita en config |
| `yggdrasil plugin enable <id>` | Quita el id de `plugins.disabled` |
| `yggdrasil plugin disable <id>` | Añade el id a `plugins.disabled` |
| `yggdrasil plugin create <name> --kind tool` | Scaffold en `extensions/` |

## Discovery

Por defecto `plugins.discoverNodeModules` está activo: cualquier paquete bajo `node_modules/@yggdrasil/*` con `yggdrasil.plugin.json` se carga al arrancar.

Plugins en `extensions/` del monorepo o del proyecto también se descubren si existen.

## Desarrollo en el monorepo

```bash
git clone <repo>
cd yggdrasil   # antes harness_pp
pnpm install
pnpm build
pnpm test
node packages/cli/dist/index.js tui
```

## Ver también

- [Configuración del provider](./provider-config.md)
- [Crear plugins](./creating-plugins.md)
- [Publicación (mantenedores)](./publishing.md)
