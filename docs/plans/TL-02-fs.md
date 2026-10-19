# TL-02 — File System Tools

**Status:** ✅ Implementado  
**Plugin:** `extensions/tool-fs`

## Objetivo

Exponer operaciones básicas de filesystem al agente con risk levels apropiados. Sin dependencias externas — solo Node built-ins (`node:fs/promises`, `node:path`).

## Tools implementadas

| Tool | Risk | Descripción |
|------|------|-------------|
| `fs_read_file` | safe | Lee archivo, soporta offset/limit para paginación |
| `fs_write_file` | destructive | Escribe/sobreescribe archivo, crea directorios padre |
| `fs_list_dir` | safe | Lista directorio, recursivo con maxDepth |
| `fs_delete` | destructive | Elimina archivo o directorio (recursive opt-in) |
| `fs_move` | moderate | Mueve/renombra archivo o directorio |

## Decisiones

- `fs_write_file` y `fs_delete` son `destructive` → piden aprobación con `harness.toolApproval: "destructive-only"` (default)
- `fs_move` es `moderate` → no pide aprobación por default pero está por encima de safe
- `fs_read_file` soporta `offset`/`limit` (líneas) para manejar archivos grandes sin saturar contexto
- `fs_delete` requiere `recursive: true` explícito para borrar directorios con contenido — nunca borra recursivo por accidente
- Paths se resuelven con `resolve()` — soporta relativos y absolutos

## Estructura

```
extensions/tool-fs/
  src/
    index.ts                 # definePlugin + registerTool x5
    tools/
      read-file.ts
      write-file.ts
      list-dir.ts
      delete-file.ts
      move-file.ts
  package.json
  tsconfig.json
  yggdrasil.plugin.json
```

## Próximo paso relacionado

TL-03 Shell execution — depende de F3-01 Sandbox. Sin sandbox, shell execution es riesgo alto.
