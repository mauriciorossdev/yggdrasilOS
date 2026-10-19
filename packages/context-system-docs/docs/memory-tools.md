# Memory CRUD tools

Part of `@yggdrasil/context-memory-db` — el agente puede leer y escribir su memoria de largo plazo.

El plugin hace dos cosas:
1. **Context provider**: inyecta automáticamente las memorias relevantes en cada conversación
2. **Tools**: el agente puede gestionar memorias explícitamente durante la conversación

## Herramientas

### `memory_add`
Guarda información permanente.

```
"Recuerda que el usuario prefiere respuestas en español y sin emojis"
→ memory_add("El usuario prefiere respuestas en español y sin emojis", "preference")
```

```json
{ "id": 42, "content": "El usuario prefiere...", "type": "preference" }
```

- `content` — texto a recordar (requerido)
- `type` — categoría: `fact`, `preference`, `instruction`, `context` (default: `fact`)

### `memory_list`
Lista memorias por relevancia.

```json
{ "limit": 10 }
```

```json
{
  "memories": [
    { "id": 42, "content": "El usuario prefiere...", "type": "preference", "relevance": 1.0 }
  ]
}
```

### `memory_search`
Busca memorias por keyword (SQLite LIKE).

```json
{ "query": "español", "limit": 5 }
```

```json
{
  "query": "español",
  "memories": [{ "id": 42, "content": "El usuario prefiere respuestas en español", "type": "preference", "relevance": 1.0 }]
}
```

### `memory_update` ⚠️ moderate
Actualiza el contenido de una memoria existente.

```json
{ "id": 42, "content": "El usuario prefiere respuestas en español, concisas y sin emojis" }
```

```json
{ "ok": true, "id": 42 }
```

### `memory_remove` ⚠️ destructive
Elimina una memoria por ID. Requiere aprobación (riskLevel: destructive).

```json
{ "id": 42 }
```

```json
{ "ok": true, "id": 42 }
```

## Context provider (automático)

Sin hacer nada, el plugin inyecta memorias en cada turno:

```
## Memories
- [preference] El usuario prefiere respuestas en español y sin emojis
- [fact] El proyecto se llama Yggdrasil
- [instruction] Siempre incluir ejemplos de código
```

El agente las recibe como contexto de sistema — no necesita llamar `memory_list` para leerlas.

## Tipos de memoria

| Tipo | Uso |
|------|-----|
| `fact` | Hechos objetivos ("el proyecto se llama X") |
| `preference` | Preferencias del usuario ("respuestas cortas") |
| `instruction` | Reglas de comportamiento ("siempre responder en español") |
| `context` | Estado del proyecto ("actualmente trabajando en TL-08") |

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Memorias no aparecen en conversación | Verificar que `context-memory-db` esté habilitado en `plugins.load.paths` |
| `memory_remove` pide aprobación | Correcto — riskLevel destructive. Aprobar con `y` |
| Búsqueda no encuentra resultados | LIKE es case-sensitive en SQLite — probar con keyword más simple |

## Ver también

- [sessions.md](./sessions.md) — historial de conversación vs memoria de largo plazo
- Plugin: `packages/context-memory-db/`
- Roadmap: `docs/plans/TL-08-memory-tools.md`
