# File System tool

Plugin `@yggdrasil/tool-fs` — operaciones de filesystem usando Node built-ins.  
Sin dependencias externas, disponible sin setup adicional.

## Herramientas

### `fs_read_file`
Lee el contenido de un archivo. Soporta paginación por líneas para archivos grandes.

```json
{ "path": "/home/user/notes.txt", "offset": 1, "limit": 100 }
```

```json
{ "path": "/home/user/notes.txt", "content": "...", "totalLines": 450, "returnedLines": 100, "offset": 1 }
```

- `offset` — línea inicial (1-based, default: 1)
- `limit` — máximo de líneas a retornar (default: 200)

### `fs_list_dir`
Lista archivos y directorios en una ruta.

```json
{ "path": "/home/user/projects", "recursive": true, "maxDepth": 2 }
```

```json
{
  "path": "/home/user/projects",
  "entries": [
    { "path": "app", "type": "dir" },
    { "path": "app/main.ts", "type": "file", "size": 1024 }
  ],
  "count": 2
}
```

### `fs_write_file` ⚠️ destructive
Escribe o sobreescribe un archivo. Crea directorios padre si no existen.

```json
{ "path": "/home/user/output.txt", "content": "Hello world\n" }
```

```json
{ "path": "/home/user/output.txt", "written": true, "bytes": 12 }
```

### `fs_move` ⚠️ moderate
Mueve o renombra un archivo o directorio.

```json
{ "from": "/tmp/draft.md", "to": "/home/user/docs/final.md" }
```

```json
{ "from": "/tmp/draft.md", "to": "/home/user/docs/final.md", "moved": true }
```

### `fs_delete` ⚠️ destructive
Elimina un archivo o directorio. Requiere `recursive: true` para directorios con contenido.

```json
{ "path": "/tmp/old-file.txt" }
```

```json
{ "path": "/tmp/old-file.txt", "deleted": true }
```

Para eliminar directorio con contenido:
```json
{ "path": "/tmp/build", "recursive": true }
```

## Niveles de riesgo

| Tool | Risk | Aprobación (default) |
|------|------|----------------------|
| `fs_read_file` | safe | No |
| `fs_list_dir` | safe | No |
| `fs_move` | moderate | No |
| `fs_write_file` | destructive | Sí |
| `fs_delete` | destructive | Sí |

La política de aprobación se configura en `harness.toolApproval` (default: `"destructive-only"`).

## Paths

- Soporta paths absolutos y relativos
- Los relativos se resuelven desde el CWD del proceso gateway
- Recomendado: usar paths absolutos para evitar ambigüedad

## Troubleshooting

| Problema | Solución |
|----------|----------|
| `ENOENT: no such file or directory` | Path incorrecto o archivo no existe |
| `EACCES: permission denied` | El proceso gateway no tiene permisos sobre ese path |
| `ENOTEMPTY: directory not empty` | Usar `recursive: true` en `fs_delete` |

## Ver también

- [browser-tool.md](./browser-tool.md)
- Plugin: `extensions/tool-fs/`
- Roadmap: `docs/plans/TL-02-fs.md`
