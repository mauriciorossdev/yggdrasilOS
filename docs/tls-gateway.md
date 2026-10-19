# TLS / HTTPS en Gateway (F3-02)

Gateway puede correr en HTTP (default, solo local) o HTTPS con TLS (para acceso remoto seguro).

## Cómo funciona

Cuando `gateway.tls.cert` y `gateway.tls.key` están configurados, el servidor usa `node:https` en lugar de `node:http`. Sin esos campos, arranca en HTTP normal.

El WebSocket cambia automáticamente: HTTP → `ws://`, HTTPS → `wss://`.

## Configuración

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 18789,
    "tls": {
      "cert": "/ruta/al/cert.pem",
      "key":  "/ruta/al/key.pem"
    }
  }
}
```

- `host: "0.0.0.0"` — escucha en todas las interfaces (necesario para acceso remoto)
- `tls.cert` — path al certificado PEM
- `tls.key` — path a la clave privada PEM

## Generar certificado self-signed (pruebas locales)

```bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem \
  -days 365 -nodes -subj "/CN=localhost"
```

Coloca ambos archivos en un directorio seguro (no en el repo).

## Generar certificado válido (producción)

Con [mkcert](https://github.com/FiloSottile/mkcert) para desarrollo en red local:

```bash
brew install mkcert
mkcert -install
mkcert 192.168.1.100  # IP de tu máquina
# genera 192.168.1.100.pem y 192.168.1.100-key.pem
```

Con Let's Encrypt para dominio público:
```bash
certbot certonly --standalone -d mi-dominio.com
# cert: /etc/letsencrypt/live/mi-dominio.com/fullchain.pem
# key:  /etc/letsencrypt/live/mi-dominio.com/privkey.pem
```

## Prueba manual

```bash
# Arrancar gateway con TLS
yggdrasil start

# Verificar HTTPS
curl -k https://localhost:18789/
# -k = allow self-signed cert

# Conectar TUI al gateway remoto
YGGDRASIL_GATEWAY_URL=wss://192.168.1.100:18789 yggdrasil tui

# WebSocket con wscat
wscat -c "wss://localhost:18789?apiKey=mi-key" --no-check
```

## Errores comunes

| Error | Causa | Fix |
|-------|-------|-----|
| `ENOENT: cert.pem` | Path incorrecto | Usar path absoluto |
| `SSL_ERROR_RX_RECORD_TOO_LONG` | Conectando HTTP a puerto HTTPS | Cambiar `ws://` → `wss://` |
| `SELF_SIGNED_CERT_IN_CHAIN` | Cert self-signed | Usar `-k` en curl, o instalar mkcert CA |
| `EACCES port 443` | Puerto privilegiado | Usar 18789 o `sudo` |

## Sin TLS (modo por defecto)

```json
{
  "gateway": {
    "host": "127.0.0.1",
    "port": 18789
  }
}
```

Sin `tls`, el gateway solo escucha en loopback — acceso solo desde la misma máquina.
