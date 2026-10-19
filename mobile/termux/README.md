# Proyectos Locales — companion de Termux

Este directorio corre **en el teléfono, dentro de Termux** — no es parte del build de la app
mobile ni del monorepo pnpm. Es lo que la app Flutter ("Proyectos Locales") habla por
`http://127.0.0.1:<puerto>` para listar/crear proyectos, ver archivos, y lanzar una terminal real
corriendo `claude` o `agy` contra un proyecto local.

## Por qué existe

`claude` y `agy` son binarios/paquetes compilados contra `glibc`. Termux usa `bionic` (la libc de
Android) — ninguno de los dos corre nativo ahí. Este bootstrap instala un chroot
[proot-distro](https://github.com/termux/proot-distro) de Ubuntu (sin root, sin build nativo) donde
sí hay glibc real, y los CLIs corren dentro de eso. Verificado a mano en un Samsung físico.

## Prerequisitos

- **Termux desde F-Droid**, no Play Store (el build de Play Store está desactualizado y no tiene
  paridad de paquetes).
- Espacio libre: contá con ~1.2GB (rootfs de Ubuntu + node + claude + agy).
- Tiempo: la primera corrida tarda varios minutos (descarga + instala ~250MB de paquetes apt
  dentro del chroot). Corridas siguientes son casi instantáneas (todo queda cacheado).

## Uso

Copiá `companion.js` y `bootstrap.sh` a Termux (por ejemplo con `curl`, `scp`, o
`termux-setup-storage` + copiar desde `~/storage/shared/`), y corré:

```sh
bash bootstrap.sh
```

Al final imprime un **token** — pegalo en la app, en Ajustes → Terminal Local. El bootstrap deja el
companion corriendo en foreground (`Ctrl+C` lo para).

Antes de cambiar a la app Yggdrasil, corré en otra sesión de Termux:

```sh
termux-wake-lock
```

Sin esto, Android puede matar Termux en background y la conexión se corta.

## Recuperar o rotar el token

- **Perdiste el token**: `cat ~/.yggdrasil-local/token`
- **Querés uno nuevo**: `rm ~/.yggdrasil-local/token && bash bootstrap.sh`

## Actualizar los CLIs

El bootstrap solo instala si falta — no actualiza versiones existentes. Para actualizar a mano:

```sh
proot-distro login ubuntu -- bash -lc 'npm install -g @anthropic-ai/claude-code'
proot-distro login ubuntu -- bash -lc 'curl -fsSL https://antigravity.google/cli/install.sh | bash'
```

## Reinstalar desde cero

```sh
proot-distro remove ubuntu
bash bootstrap.sh
```

Esto borra el chroot completo (incluye cualquier sesión logueada de `claude`/`agy` dentro de él) y
lo vuelve a crear.
