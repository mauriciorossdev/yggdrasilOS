# Desplegar el servidor de enlace en Railway

Railway es una de las formas de alojar el servidor de enlace. La guía general está en [`deploy/README.md`](../README.md); aquí solo van los pasos propios de Railway. Este repositorio trae un `railway.toml`, que construye con el `Dockerfile` de la raíz.

## 1. Crear el servicio

Lo más rápido es usar la imagen publicada: en el panel, **New Project → Docker Image**, con `ghcr.io/mauriciorossdev/yggdrasil-gateway` y la versión de tu app de escritorio como etiqueta (por ejemplo `ghcr.io/mauriciorossdev/yggdrasil-gateway:0.2.0`). No construye nada.

Para construirla desde el código, usa la [CLI de Railway](https://docs.railway.com/guides/cli) desde tu copia del repositorio:

```bash
railway login
railway init
railway up --detach
```

También puedes conectar tu propio fork desde el panel: **New Project → Deploy from GitHub repo**. La construcción tarda varios minutos.

## 2. Definir las variables

En el servicio, pestaña **Variables**:

| Variable | Para qué | Obligatoria |
|---|---|---|
| `YGGDRASIL_API_KEY` | Clave del servidor. Sin ella no arranca. Mira [cómo generarla](../README.md#1-generar-la-clave) | Sí |
| `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `FCM_SERVICE_ACCOUNT_JSON` | [Asistente en la nube](../README.md#asistente-en-la-nube-opcional) | No |

`PORT` lo define Railway, y la imagen lo usa automáticamente: no lo definas a mano.

## 3. Añadir un volumen (opcional)

El enlace funciona sin volumen. El asistente lo necesita para conservar su memoria y sus sesiones: en el servicio, **Volumes → New Volume**, montado en `/data`.

## 4. Obtener la URL

En **Settings → Networking → Generate Domain**. Te dará una URL `https://…up.railway.app`, con TLS incluido. Úsala para [conectar la app de escritorio](../README.md#4-conectar-la-app-de-escritorio).

## Actualizar

Con la imagen publicada, cambia la etiqueta en **Settings → Source** a la versión nueva. Si construyes desde el código:

```bash
railway up --detach
```

## Workflows en la nube

El mismo gateway puede ejecutar workflows con triggers de schedule y webhook, `http.request` y nodos de lógica. Los nodos `desktop.*` y `phone.*` no funcionan ahí, porque no hay pantalla ni teléfono conectados a ese proceso.

No hay interfaz para editarlos: las definiciones (`.yggdrasil/workflows/<id>.json`, en el mismo formato que usa la app de escritorio) deben llegar al volumen, en `/data/project`, por ejemplo con `railway ssh`. Los workflows en la nube no se han probado de punta a punta.
