# API Keys para Gateway (F3-05)

Soporta una key legacy o lista de keys con nombre y fecha de expiración. Útil para dar acceso temporal a testers.

## Cómo funciona

Al conectar al gateway, el cliente envía la key de dos formas:
1. **Query param**: `ws://localhost:18789?apiKey=mi-key`
2. **Mensaje auth**: `{ "method": "auth", "params": { "apiKey": "mi-key" } }`

El servidor valida contra la lista de keys. Si alguna coincide y no está expirada, autentica.

Si no hay keys configuradas, el gateway no requiere auth (modo abierto).

## Configuración

### Key única (legacy, sigue funcionando)

```json
{
  "auth": {
    "gateway": {
      "apiKey": "mi-secret-key"
    }
  }
}
```

También acepta variable de entorno:
```bash
export YGGDRASIL_API_KEY=mi-secret-key
```

### Múltiples keys (F3-05)

```json
{
  "auth": {
    "gateway": {
      "apiKeys": [
        { "key": "key-produccion-abc123", "name": "main" },
        { "key": "key-tester-alice",   "name": "alice" },
        { "key": "key-tester-ana",        "name": "ana",      "expiresAt": 1767225600000 },
        { "key": "key-temporal-demo",     "name": "demo",     "expiresAt": 1751000000000 }
      ]
    }
  }
}
```

- `key` — string secret (generado con `openssl rand -hex 32`)
- `name` — etiqueta para identificar al tester (solo informativo)
- `expiresAt` — timestamp Unix en **milisegundos** (opcional). Si se omite, no expira.

### Combinar legacy + lista

```json
{
  "auth": {
    "gateway": {
      "apiKey": "key-admin",
      "apiKeys": [
        { "key": "key-tester-1", "name": "tester-1", "expiresAt": 1767225600000 }
      ]
    }
  }
}
```

La key legacy actúa como `{ key: "...", name: "default" }` y se agrega primero a la lista.

## Generar keys seguras

```bash
# Una key
openssl rand -hex 32

# Tres keys de una vez
for i in 1 2 3; do echo "key-$i: $(openssl rand -hex 32)"; done
```

## Calcular expiresAt

```bash
# Fecha → timestamp ms
node -e "console.log(new Date('2025-12-31').getTime())"
# → 1767139200000

# Timestamp ms → fecha
node -e "console.log(new Date(1767139200000).toISOString())"
```

## Prueba manual

```bash
# Conectar con apiKey en query param (wscat)
wscat -c "ws://localhost:18789?apiKey=key-tester-alice"

# Conectar sin key → debe rechazar
wscat -c "ws://localhost:18789"
# < {"error":{"code":"UNAUTHORIZED","message":"Authentication required..."}}

# Auth por mensaje (cuando query no se usa)
wscat -c "ws://localhost:18789"
> {"method":"auth","params":{"apiKey":"key-tester-alice"},"id":1}
# < {"id":1,"result":{"ok":true}}

# Key expirada → debe rechazar con UNAUTHORIZED
```

## Revocar una key

Eliminar la entrada del array `apiKeys` en el config y reiniciar el gateway. La key queda inválida de inmediato.

## Forzar auth aunque no haya keys

```json
{
  "auth": {
    "gateway": {
      "required": true,
      "apiKeys": []
    }
  }
}
```

Con `required: true` y lista vacía, nadie puede conectar (modo lockout total).
