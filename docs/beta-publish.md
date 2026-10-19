# Publicar beta en npm

## Prerequisitos (una sola vez)

1. Cuenta en [npmjs.com](https://npmjs.com)
2. Crear org `@yggdrasil` en npm (si no existe):
   - npmjs.com → Add Organization → nombre: `yggdrasil` → Free plan
3. `npm login` desde terminal

## Publicar

```bash
# Desde la raíz del monorepo:

# 1. Preparar versiones y metadata
node scripts/prepare-publish.mjs --version 0.1.0-beta.1

# 2. Build
pnpm build

# 3. Publicar con tag beta (NO setea latest)
pnpm publish -r --tag beta --no-git-checks
```

Eso publica 32 packages: core + extensiones.

## Lo que le mandas a los testers

```bash
# Instalar CLI
npm install -g @yggdrasil/cli@beta

# Crear proyecto
mkdir mi-agente && cd mi-agente
yggdrasil init

# Configurar API key (elegir una)
export OPENAI_API_KEY=sk-...
export OLLAMA_API_KEY=...

# Arrancar TUI
yggdrasil tui
```

### Plugins opcionales (instalar según lo que quieran probar)

```bash
yggdrasil plugin install @yggdrasil/tool-browser@beta    # browser automation
yggdrasil plugin install @yggdrasil/tool-fs@beta         # filesystem
yggdrasil plugin install @yggdrasil/tool-search@beta     # web search (necesita BRAVE_SEARCH_API_KEY)
yggdrasil plugin install @yggdrasil/tool-fetch@beta      # http fetch
yggdrasil plugin install @yggdrasil/tool-image@beta      # vision (necesita modelo con vision)
yggdrasil plugin install @yggdrasil/channel-discord@beta # bot Discord
yggdrasil plugin install @yggdrasil/channel-telegram@beta # bot Telegram
yggdrasil plugin install @yggdrasil/service-cron@beta    # tareas programadas
```

## Por qué es "privado"

Tag `beta` no setea `latest`. `npm install @yggdrasil/cli` sin `@beta` devuelve "not found".  
Solo quien tiene el comando exacto puede instalarlo.

## Próxima versión beta

```bash
node scripts/prepare-publish.mjs --version 0.1.0-beta.2
pnpm build
pnpm publish -r --tag beta --no-git-checks
```

## Cuando sea pública (release)

```bash
node scripts/prepare-publish.mjs --version 0.1.0
pnpm build
pnpm publish -r --tag latest --no-git-checks
```
