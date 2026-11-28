# Roadmap

Yggdrasil is a desktop agentic development environment: run coding agents side by side, keep their work apart and
review it before it lands. This page says where it is going. It has no dates and no promises; issues and pull requests
are welcome.

## What we care about

- **Many agents, one developer.** The hard part is not starting an agent but knowing what several are doing, keeping
  them from stepping on each other and reviewing what they produce.
- **Bring your own agent.** The app runs the CLIs you already use instead of replacing them.
- **Organic Driven Development (ODD).** How agents are meant to work here: as much process as the task needs and no
  more. Small work is done directly; larger work gets a written brief first, is ticked off only with observed proof,
  and is integrated by you.
- **Maintainable code.** One package per responsibility, plugins instead of a growing core, and documentation that a
  test keeps in step with the repository.
- **Tests that mean something.** Pure logic in small modules with unit tests, integration and end-to-end suites with
  mock providers in CI, and live runs of the app before a feature is called done.
- **Your machine, your credentials.** No hosted backend and no bundled keys.

## Today

- Terminals running Claude Code, GitHub Copilot CLI, Antigravity and omp, in a grid or on a canvas.
- Links between projects: an agent in one can read or write another's panes, asking you first.
- Git worktrees per task: merge, publish as a pull request or discard.
- With Claude Code: which pane is waiting or done, and queued messages.
- Agent Flow and scheduled workflows.
- Comments on diffs and files sent back to an agent as a prompt.
- Documents, Studio (plugins and widgets built by an agent) and a Dashboard of your widgets.
- A platform underneath: gateway, plugins, providers (Anthropic, Ollama, OpenAI-compatible), channels (HTTP,
  Discord, Slack, Telegram) and a phone app.

## Next

- **ODD:** make its remaining steps explicit to agents, such as confirming that a request authorizes code changes and
  closing with what was not verified.
- **Startup time:** measure it, then load the heavy parts of the desktop app only when they are used.
- **Smaller modules:** split the largest files of the desktop app and the gateway, without changing behavior.
- **Documentation in English:** the remaining guides.
- **Dashboard:** sync layout and settings between computers (never secrets).
- **Office documents:** verify editing against real Excel, Word and PowerPoint files.

## Exploring

- **Remote workspaces:** open a project that lives on a server or in a container.
- **Signed installers** and published npm packages.
