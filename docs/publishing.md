# Publicación en npm (mantenedores)

## Paquetes publicables

Core `@yggdrasil/*` en `packages/` más `@yggdrasil/tool-weather`.

Version actual del spine: **0.4.0**.

## Preparar metadata

```bash
node scripts/prepare-publish.mjs
pnpm install
pnpm build
pnpm test
```

## Dry-run

```bash
pnpm publish -r --dry-run --access public
```

`pnpm publish` reescribe `workspace:*` a versiones semver en los tarballs.

## Orden de publicación

Publicar en orden de dependencias (el script `prepare-publish` no publica; hazlo manualmente o con CI):

1. `tools-sdk` → `sdk` → `config` → `sessions` → `kernel`
2. `harness-runtime`, `tools-runtime`, `tool-builtin`
3. `pipeline`, `provider-openai-compat`, `harness-llm`
4. `gateway`, `channel-tui`, `channel-http`
5. `cli`, `tool-weather`

## CI

El workflow `.github/workflows/publish.yml` publica en push de tags `v*`.

**Secret requerido:** `NPM_TOKEN` con permiso de publish para la org `@yggdrasil`.

## Tag de release

```bash
git tag v0.4.0
git push origin v0.4.0
```

## Notas

- El root del monorepo permanece `"private": true`.
- Cada paquete incluye `prepublishOnly: pnpm run build`.
- Crear la org/npm scope `@yggdrasil` antes del primer publish real.
