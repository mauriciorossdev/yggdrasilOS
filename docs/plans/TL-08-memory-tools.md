# TL-08 — Memory CRUD Tools

**Status:** ✅ Implementado  
**Plugin:** `packages/context-memory-db` (incorporado al plugin existente)

## Objetivo

Exponer las operaciones de memoria como tools que el agente puede invocar explícitamente durante una conversación, complementando el context provider que inyecta memorias automáticamente en el contexto.

## Decisión de arquitectura

Las tools se incorporaron directamente en `packages/context-memory-db/src/index.ts` en vez de crear un package separado:
- Misma DB singleton — tools y context provider comparten la instancia
- Sin duplicación de dependencias (`better-sqlite3`)
- Un solo plugin registra tanto el context provider como las tools

## Tools implementadas

| Tool | Risk | Descripción |
|------|------|-------------|
| `memory_add` | safe | Guarda información en memoria permanente |
| `memory_list` | safe | Lista memorias por relevancia |
| `memory_search` | safe | Búsqueda por keyword (SQLite LIKE) |
| `memory_update` | moderate | Actualiza contenido de una memoria por ID |
| `memory_remove` | destructive | Elimina memoria por ID |

## Cambios en context-memory-db

- `db.ts`: nueva función `searchMemories(db, query, agentId?, limit?)` — SQLite `LIKE %query%`
- `index.ts`: 5 `defineTool()` + 5 `api.registerTool()` en `register()`
- `package.json`: agregado `@yggdrasil/tools-sdk: workspace:*`

## Flujo context provider vs tools

```
Contexto auto (context provider):
  assemble() → queryMemories() → inyecta en system prompt
  El agente lee memorias como contexto, no como tool call

CRUD explícito (tools):
  agente llama memory_add("El usuario prefiere respuestas cortas")
  → addMemory() → persiste en SQLite
  → próxima sesión: context provider las incluye en sistema
```

## Próximo paso relacionado

EC-01 Semantic memory — reemplazar búsqueda LIKE con embeddings vectoriales.
