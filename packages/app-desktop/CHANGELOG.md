# Changelog — @yggdrasil/app-desktop

Manual changelog, one entry per `app-desktop-v*` release tag. See the app-desktop production-readiness plan for release process/tooling.

## Unreleased
- Added main-process crash logging (`uncaughtException`/`unhandledRejection` to `app.getPath("logs")/main-crashes.log`).
- Added About panel/menu entry showing app version.
- Added self-hosted auto-update wiring (`electron-updater`, generic provider) — inactive on macOS until code signing is configured.
- Added `.github/workflows/release-desktop.yml` for building installers on `app-desktop-v*` tags (unsigned for now).
