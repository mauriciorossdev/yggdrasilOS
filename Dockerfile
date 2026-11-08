# Headless Yggdrasil gateway (`yggdrasil gateway`): the permanent server the
# desktop and the phone connect through (deploy/README.md). Published to
# ghcr.io/mauriciorossdev/yggdrasil-gateway by .github/workflows/gateway-image.yml.
#
# It needs only YGGDRASIL_API_KEY to work as a link server. An AI provider key
# (e.g. ANTHROPIC_API_KEY) and a volume on /data add the cloud assistant.
#
# This is NOT the desktop app: no Electron and no desktop_* / phone_* workflow
# nodes, which need a real screen or phone attached to this process.

FROM node:22-slim AS build

# python3/make/g++: native addons (better-sqlite3) may need to compile when no
# prebuilt binary matches the platform. Only the build stage carries them.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pin pnpm to the version the lockfile/onlyBuiltDependencies were made with;
# unpinned corepack pulls the latest major, which handles build scripts differently.
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /app
# What this copies is decided by .dockerignore, an allowlist.
COPY . .

# app-desktop is excluded from install too: its postinstall runs
# electron-rebuild, which overwrites the shared better-sqlite3 binary with an
# Electron-ABI build and the Node gateway then fails to load it
# (NODE_MODULE_VERSION mismatch).
RUN pnpm install --frozen-lockfile --filter='!@yggdrasil/app-desktop'

# mobile/* is excluded implicitly: the filters only match packages/** and extensions/**.
RUN pnpm --filter='./packages/**' --filter='./extensions/**' \
         --filter='!@yggdrasil/app-desktop' \
         -r run build

# Drop what only the build needed. Keeps the layout: the kernel finds plugins
# through /app/packages and /app/extensions (see the config template).
RUN CI=true pnpm install --prod --frozen-lockfile --filter='!@yggdrasil/app-desktop'

# A Windows checkout may have CRLF line endings, which would break the shebang.
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh


FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app

# Hosts that inject $PORT override this; it's documentation, not binding.
EXPOSE 8787

# Any path answers with the gateway's identity once it is listening.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD \
  node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.YGGDRASIL_GATEWAY_PORT||8787)+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
