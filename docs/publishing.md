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

El workflow `.github/workflows/publish.yml` solo se lanza a mano, desde **Actions → Publish npm → Run workflow**. Ninguna etiqueta lo dispara, porque una publicación en npm prácticamente no se puede retirar.

- Sin marcar **publish**, hace un dry-run: compila, prueba y empaqueta, pero no sube nada.
- Marcado, publica de verdad. Solo funciona desde `main`.

**Secret requerido:** `NPM_TOKEN` con permiso de publish para la org `@yggdrasil`.

Los paquetes de ejemplo (`my-tool`, `echo-channel`, `tool-destructive-demo`) son `"private": true` y no se publican.

## Notas

- El root del monorepo permanece `"private": true`.
- Cada paquete incluye `prepublishOnly: pnpm run build`.
- Crear la org/npm scope `@yggdrasil` antes del primer publish real.
