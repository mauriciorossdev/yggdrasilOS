# Installation

## Desktop app

Download the installer for your system from the
[releases page](https://github.com/mauriciorossdev/yggdrasilOS/releases/latest). The notes of each release explain how
to open it while the installers are not code signed.

## From source (CLI, gateway and desktop)

The packages are not published to npm yet, so everything runs from the repository.

Requirements: Node.js **22 or later** and pnpm.

```bash
git clone https://github.com/mauriciorossdev/yggdrasilOS.git
cd yggdrasilOS
pnpm install
pnpm build
pnpm test
```

Then start what you need:

```bash
pnpm desktop                              # desktop app
node packages/cli/dist/index.js tui       # gateway and terminal client
node packages/cli/dist/index.js gateway   # headless gateway
node packages/cli/dist/index.js run       # gateway and all enabled channels
```

Set an API key first, for example `export OLLAMA_API_KEY=...` ([provider configuration](./provider-config.md)).

## Workspace root

The CLI finds the project folder like this:

1. The `YGGDRASIL_WORKSPACE` environment variable.
2. The folder with `yggdrasil.config.json`, searching upwards from the current one.
3. The current folder.

`node packages/cli/dist/index.js init` creates a `yggdrasil.config.json` with an agent, the gateway and channels.

## Plugins

Plugins are discovered at startup from `packages/` and `extensions/` in the workspace, the folders in
`plugins.load.paths`, and `node_modules/@yggdrasil/*` (unless `plugins.discoverNodeModules` is off).

| Command | What it does |
|---|---|
| `plugin list` | Installed plugins and their state |
| `plugin install <package>` | Installs an npm package and enables it |
| `plugin enable <id>` | Removes the id from `plugins.disabled` |
| `plugin disable <id>` | Adds the id to `plugins.disabled` |
| `plugin create <name> --kind tool` | Scaffolds a plugin in `extensions/` |

Run them as `node packages/cli/dist/index.js <command>`.

## See also

- [Provider configuration](./provider-config.md)
- [Creating plugins](./creating-plugins.md)
- [Publishing (maintainers)](./publishing.md)
