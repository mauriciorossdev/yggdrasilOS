# Headless Yggdrasil gateway (`yggdrasil gateway`), for running workflows
# (packages/workflows + extensions/service-workflows) in the cloud — e.g.
# Railway. This is NOT the desktop app: no Electron, no desktop_* / phone_*
# tool nodes (they need a real screen/phone attached to the gateway process,
# see extensions/service-workflows's paneControlServer dependency). What
# DOES work here: schedule/webhook/mobile-style remote triggers,
# http.request, agent.ask (Claude), and all the logic nodes (if/switch/
# loop/delay/set).
#
# First-pass Dockerfile — not live-tested yet (see deploy/railway/README.md
# §"Known gaps / not yet tested"). Single-stage on purpose: a pnpm monorepo
# this size is easy to break with aggressive multi-stage dependency pruning
# before we've ever actually booted the image once. Trim it down as a
# follow-up once this is confirmed working, not before.

FROM node:22-slim

# python3/make/g++: some workspace packages depend on native addons
# (e.g. better-sqlite3 via packages/context-memory-db, packages/sync-server)
# that may need to compile from source if no prebuilt binary matches the
# image's platform/arch. node-pty itself (the heaviest native dep) is only
# pulled in by packages/app-desktop, which we deliberately exclude from the
# build below, so it's not a concern here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pin pnpm to the version the lockfile/onlyBuiltDependencies were made with;
# unpinned corepack pulls the latest major, which handles build scripts differently.
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /app
COPY . .

# app-desktop is excluded from install too: its postinstall runs
# electron-rebuild, which overwrites the shared better-sqlite3 binary with an
# Electron-ABI build and the Node gateway then fails to load it
# (NODE_MODULE_VERSION mismatch).
RUN pnpm install --frozen-lockfile --filter='!@yggdrasil/app-desktop'

# Build everything under packages/ and extensions/ EXCEPT app-desktop
# (Electron — heavy, needs a desktop/display, irrelevant to a headless
# gateway, and its postinstall downloads a large binary for nothing).
# mobile/* is excluded implicitly: pnpm-workspace.yaml includes it, but
# our filters below only match packages/** and extensions/**.
RUN pnpm --filter='./packages/**' --filter='./extensions/**' \
         --filter='!@yggdrasil/app-desktop' \
         -r run build

RUN chmod +x docker-entrypoint.sh

# Railway injects its own $PORT at runtime; docker-entrypoint.sh maps it to
# YGGDRASIL_GATEWAY_PORT. This EXPOSE is documentation, not binding.
EXPOSE 8787

ENTRYPOINT ["/app/docker-entrypoint.sh"]
