# Contributing to Yggdrasil

Thanks for your interest! Yggdrasil is pre-1.0 and moves quickly, so please open an issue before starting anything
large.

## Setup

Requirements: Node >= 22 and pnpm.

```bash
pnpm install
pnpm build        # compiles every package (the desktop app needs the packages built first)
pnpm test         # unit + integration + e2e with mock providers — no API key needed
pnpm typecheck
```

Live tests (`pnpm test:live`) call a real model and need `OLLAMA_API_KEY`; they skip themselves without it.

The desktop app: `pnpm desktop`. See `AGENTS.md` for the monorepo layout, test architecture and how to scaffold a
plugin (`yggdrasil create-plugin`).

## Pull requests

- Branch from `main`; keep one concern per PR.
- Add or update tests for behavior you change. Pure logic belongs in small, separately testable modules.
- Run `pnpm build`, `pnpm typecheck` and `pnpm test` before pushing.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat(desktop): …`, `fix(gateway): …`).
- Never commit secrets, local paths, API keys or personal data. `.mcp.json`, `google-services.json` and `.env*` are
  git-ignored for that reason.

## Reporting bugs and security issues

Bugs and feature ideas: open a GitHub issue. Security problems: see [SECURITY.md](SECURITY.md) — please do not file
them publicly.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
