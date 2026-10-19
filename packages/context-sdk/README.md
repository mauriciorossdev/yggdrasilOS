# @yggdrasil/context-sdk

## Purpose

Type-only contract package for the "context provider" mechanism. It defines the shape that any
source of system context (memory, project info, prompt files, etc.) must implement in order to be
plugged into the context-assembly pipeline. It has no runtime logic, no dependencies, and emits no
executable code beyond type aliases — this is the interface layer that everything else in the
`context-*` family implements against or consumes.

## Public API

All exports are TypeScript types (`packages/context-sdk/src/index.ts`):

- `ContextProviderContext` — the input handed to a provider when it's asked to assemble context:
  `{ sessionKey, agentId, workspaceRoot, config, globalConfig, metadata? }`. `config` is whatever
  slice of plugin config the caller decided to pass in (see the caveat in
  `@yggdrasil/context-runtime`'s README — this is not always what you'd expect).
- `ContextBlock` — one unit of assembled context: `{ role: "system", content, source, priority,
  tokens?, cacheable?, ttlMs? }`. `priority` controls ordering (ascending — lower sorts first);
  `tokens` is an optional pre-computed size estimate; `cacheable`/`ttlMs` control caching behavior
  in the runtime's cache.
- `ContextProvider` — the interface a context source implements: `{ id, label?, priority?,
  supports?(ctx), assemble(ctx): Promise<ContextBlock[]> }`. `supports()` is an optional early-exit
  predicate; `assemble()` does the actual work.
- `ContextProviderRegistration` — currently just an alias for `ContextProvider`, used as the type
  stored in the kernel's plugin registry.

## Depends on

Nothing. `package.json` declares no `dependencies`.

## Used by

- `@yggdrasil/context-runtime` (consumes `ContextBlock`/`ContextProviderContext`)
- `@yggdrasil/context-memory-db`, `@yggdrasil/context-memory-local`, `@yggdrasil/context-project`,
  `@yggdrasil/context-prompt-files` (each implements `ContextProvider`)
- `@yggdrasil/sdk` (`packages/sdk/src/plugin.ts` re-exports `ContextProviderRegistration`,
  `ContextProvider`, `ContextBlock`, `ContextProviderContext` so plugin authors get these types
  through the main SDK import rather than needing a direct dependency on this package)

## Configuration

None — this package has no runtime behavior and reads no config.

## Extending / what's safe to change

To add a new context source, don't modify this package — implement the `ContextProvider`
interface in a new package (or an existing one) and register it via
`api.registerContextProvider(...)` from a plugin's `register()`. This package should stay
dependency-free and types-only; if you need to add a field to `ContextBlock` or
`ContextProviderContext`, treat it as a breaking change across every package listed under "Used
by" above, since they all destructure these shapes directly.
