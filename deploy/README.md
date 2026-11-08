# Tu propio servidor de enlace

El servidor de enlace conecta la app del teléfono con Yggdrasil en tu computador desde cualquier red, sin VPN y sin escribir IP, puerto ni clave en el teléfono. Es un gateway de Yggdrasil corriendo en un sitio siempre encendido, y funciona igual en cualquier host que ejecute Docker.

```
Teléfono ──► Servidor de enlace ◄── App de escritorio
               (lo despliegas tú)
```

La app solo necesita dos datos: su **URL** y su **clave**.

**¿Prefieres que te guíen?** En la app de escritorio, **Ajustes → Teléfono → Crear mi servidor de enlace** genera la clave y los comandos para tu caso, y comprueba el resultado. Esta guía explica lo mismo con más detalle.

## Elige dónde desplegarlo

| Opción | Para quién | Necesitas | URL final |
|---|---|---|---|
| [VPS con dominio](#opción-a-vps-con-dominio) | Acceso desde cualquier red, con tu servidor | VPS, dominio y puertos 80 y 443 | `https://gateway.tu-dominio.com` |
| [Plataforma en la nube](#opción-b-plataforma-en-la-nube) | No quieres administrar un servidor | Cuenta en Railway u otra similar | La que te dé la plataforma |
| [Cloudflare Tunnel](#opción-c-cloudflare-tunnel) | Tu PC o NAS, sin abrir puertos | Dominio en Cloudflare. **Sin probar** | `https://gateway.tu-dominio.com` |
| [Red local o Tailscale](#opción-d-red-local-o-tailscale) | Solo desde tu red o tu tailnet | Docker | `http://192.168.x.x:8787` |

La app **bloquea `http://` y `ws://` en direcciones públicas**, porque expondrían tu clave. Sin cifrar solo se permite en la red local y en Tailscale.

## 1. Generar la clave

La clave la eliges tú; no la entrega ningún servicio. Puedes crearla en **Ajustes → Teléfono → Generar clave** de la app de escritorio, o con cualquiera de estos comandos:

```bash
# Linux, macOS o Git Bash
openssl rand -hex 32

# Cualquier sistema con Node, incluido Windows
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Da acceso completo al servidor, y el servidor guarda las claves de tus escritorios. Trátala como una contraseña.

## 2. Preparar la configuración

Para todas las opciones salvo la plataforma en la nube, desde la raíz de tu copia del repositorio:

```bash
cp deploy/.env.example deploy/.env
```

Edita `deploy/.env` y pega la clave en `YGGDRASIL_API_KEY`. Cada opción añade lo suyo.

## 3. Desplegar

Construir la imagen compila todo el proyecto y pide bastante memoria. Si tu servidor es pequeño, [constrúyela en tu PC y envíala](#servidores-pequeños). Para correr, al servidor le basta con 1 GB de RAM libre y 2 GB de disco.

### Opción A: VPS con dominio

Usa Caddy, que obtiene y renueva el certificado TLS solo.

1. Apunta un registro DNS `A` de tu dominio a la IP del servidor.
2. Abre los puertos 80 y 443.
3. Añade tu dominio a `deploy/.env`:
   ```bash
   DOMAIN=gateway.tu-dominio.com
   ```
4. Arranca:
   ```bash
   docker compose -f deploy/docker-compose.yml up -d --build
   ```
5. Comprueba que responde:
   ```bash
   curl https://gateway.tu-dominio.com/
   # {"ok":true,"service":"yggdrasil-gateway","ui":"/ui"}
   ```

Si el certificado tarda o falla, revisa `docker compose -f deploy/docker-compose.yml logs caddy`. Casi siempre es el DNS o un puerto cerrado.

### Opción B: Plataforma en la nube

Crea un servicio a partir del `Dockerfile` de la raíz, define la variable `YGGDRASIL_API_KEY` y usa la URL pública `https://` que te dé la plataforma. WebSocket debe estar permitido. La imagen usa el `$PORT` que le inyecte el host.

[Railway tiene su propia guía](railway/README.md). Una versión anterior de la imagen se usó allí, pero esta aún no se ha probado en Railway ni en otras plataformas, aunque deberían funcionar igual.

### Opción C: Cloudflare Tunnel

> **Sin probar:** esta opción está preparada, pero aún no se ha ejecutado contra una cuenta real de Cloudflare. Si la usas, confirma cada paso.

No necesitas IP pública ni abrir puertos.

1. En Cloudflare Zero Trust, crea un túnel y copia su token.
2. En ese túnel, añade un **Public Hostname** con tu dominio y el servicio `http://gateway:8787`.
3. Añade el token a `deploy/.env`:
   ```bash
   TUNNEL_TOKEN=tu-token
   ```
4. Arranca:
   ```bash
   docker compose -f deploy/docker-compose.cloudflare.yml up -d --build
   ```

Cloudflare descifra el tráfico en sus servidores antes de reenviarlo, así que también puede verlo. Tenlo en cuenta en la [sección de seguridad](#seguridad).

### Opción D: Red local o Tailscale

```bash
docker build -t yggdrasil-gateway .

docker run -d --name yggdrasil-gateway --restart unless-stopped \
  --env-file deploy/.env \
  -p 8787:8787 \
  -v yggdrasil-data:/data \
  yggdrasil-gateway

curl http://localhost:8787/
# {"ok":true,"service":"yggdrasil-gateway","ui":"/ui"}
```

Tu URL será `http://192.168.x.x:8787` o, con Tailscale, `http://100.x.x.x:8787`. **No abras este puerto a internet:** va sin cifrar.

### Servidores pequeños

Sin registro de imágenes, puedes construir en tu PC y enviar el resultado por SSH. Tu PC y el servidor deben tener la misma arquitectura:

```bash
docker build -t yggdrasil-gateway .
docker save yggdrasil-gateway | gzip | ssh usuario@tu-servidor 'gunzip | docker load'
```

Después, en el servidor, usa `up -d` sin `--build`:

```bash
docker compose -f deploy/docker-compose.yml up -d
```

## 4. Conectar la app de escritorio

En **Ajustes → Teléfono**:

1. Escribe la URL y pega la clave.
2. Pulsa **Probar conexión**. Si falla, consulta [Problemas frecuentes](#problemas-frecuentes).
3. Pulsa **Guardar**.
4. Marca **Publicar este equipo en el servidor de enlace**.
5. Si la app avisa de que un proyecto "se abrió antes de activar la publicación", ciérralo y vuelve a abrirlo. Desde ese momento, sus gateways exigen una clave a todo lo que no sea tu propio equipo.

Abajo verás **Publicado** y **Túnel: conectado**.

## 5. Conectar el teléfono

1. En el escritorio, pulsa **Mostrar QR para el teléfono**. El QR contiene la clave: no lo compartas.
2. En la app del teléfono, abre **Configuración → Perfiles de conexión → Escanear QR del desktop**.
3. Abre **Escritorios** en esa misma pantalla y toca un proyecto.

La app prueba primero Tailscale y la red local, y usa el túnel del servidor si no llega por ellas.

## Asistente en la nube (opcional)

Sin más configuración, el servidor solo enlaza el teléfono con tu computador, que debe estar encendido. Para tener además un asistente que responda con el computador apagado, añade a `deploy/.env` una clave de IA y conserva el volumen en `/data`:

| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | El asistente (usa Anthropic) |
| `REPLICATE_API_TOKEN` | Voz del asistente |
| `FCM_SERVICE_ACCOUNT_JSON` | Notificaciones y recordatorios con la app cerrada. Debe ser del mismo proyecto de Firebase que tu compilación de la app |

Tiene costo según el uso de cada proveedor.

## Mantenimiento

**Actualizar.** Tus datos están en el volumen y se conservan:

```bash
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

Con la opción D, reconstruye con `docker build`, borra el contenedor con `docker rm -f yggdrasil-gateway` y vuelve a lanzar el `docker run`.

La configuración del volumen se reescribe en cada arranque desde la plantilla. Si la editaste a mano, añade `YGGDRASIL_KEEP_CONFIG=1` a `deploy/.env`.

**Cambiar la clave.** Actualiza `deploy/.env`, recrea el contenedor con el comando de arriba, pégala en Ajustes → Teléfono y vuelve a escanear el QR en cada teléfono.

**Copia de seguridad.** Todo está en el volumen de datos. `docker volume ls` muestra su nombre: `yggdrasil-data` con la opción D, y `deploy_yggdrasil-data` con compose.

```bash
docker run --rm -v yggdrasil-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/yggdrasil-data.tgz -C /data .
```

Para restaurarla, con el contenedor detenido:

```bash
docker run --rm -v yggdrasil-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/yggdrasil-data.tgz -C /data
```

En Git Bash de Windows, antepón `MSYS_NO_PATHCONV=1` a estos dos comandos.

El archivo contiene las claves de tus escritorios. Guárdalo como un secreto.

**Sin volumen.** El enlace funciona igual: los escritorios se vuelven a registrar en un minuto. Lo que se pierde al reiniciar son la memoria, las sesiones y los documentos del asistente.

## Problemas frecuentes

Estos son los mensajes de **Probar conexión**:

| Mensaje | Qué revisar |
|---|---|
| No se pudo conectar con el servidor | Que los contenedores estén en marcha (`docker ps`), la URL y el firewall. Con `CERT_…` en el detalle, el certificado TLS no es válido |
| Responde, pero no es un gateway de Yggdrasil | La URL apunta a otro servicio, o el proxy no envía al puerto correcto |
| El servidor rechazó la clave | Debe coincidir exactamente con `YGGDRASIL_API_KEY`. Si la cambiaste, recrea el contenedor |
| El servidor no tiene clave | No debería ocurrir con esta imagen: estás conectando a otro gateway |
| No admite el directorio de escritorios | Actualiza la imagen |
| Pega la clave de este servidor | Cambiaste la URL. La clave guardada nunca se envía a otra dirección |

Otros síntomas:

- **`Túnel: sin conexión` con la prueba correcta:** el proxy no está dejando pasar WebSocket.
- **El teléfono no ve un proyecto:** ciérralo y ábrelo en el escritorio (paso 4).
- **El teléfono dice que el QR no es válido:** si avisa de que el servidor es público y sin cifrar, configúralo con `https://`.
- **`Warning: couldn't take ownership` en los logs:** el volumen no admite cambiar de dueño y el servidor sigue como root. Funciona, pero conviene usar un volumen que lo permita.

## Seguridad

- **Quien controla el servidor ve tu tráfico.** El túnel no cifra de extremo a extremo: el contenido de tus sesiones pasa descifrado por el servidor. Despliégalo solo en un host en el que confíes.
- **Las claves de tus escritorios están en el servidor,** en texto plano en el volumen, y cualquiera con la clave del servidor puede obtenerlas.
- **Si la clave se filtra:** cámbiala de inmediato. También puedes borrar el registro de escritorios (`/data/project/.yggdrasil/assistant/desktops.json`): se volverán a registrar en un minuto.
- **La imagen corre sin root** cuando puede adueñarse del volumen, y no incluye compiladores.
