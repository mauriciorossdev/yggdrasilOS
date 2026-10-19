# Security policy

Yggdrasil is pre-1.0. Security fixes land on `main`.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private vulnerability reporting
(*Security → Report a vulnerability* on the repository) with a description, reproduction steps and the affected
version or commit. You can expect an acknowledgement within a few days.

## Things worth knowing when you deploy

- The gateway authenticates clients with API keys; keep them out of version control and rotate any that leak.
- Agent tools can run commands and edit files on the host. Review tool approval settings before exposing a gateway
  beyond localhost.
- The optional sync server and hub are self-hosted; their URLs and keys are configured by you, never baked in.
