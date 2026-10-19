import type { PluginRecord } from "../types.js";

/** Which CLI a Studio terminal launches — the user always picks, see StudioWorkspace's harness selector. */
export type StudioTerminalHarness = "claude" | "agy";

/**
 * Context text for the Estudio's Terminal mode. The terminal's cwd is
 * always the project root (never the plugin's own subfolder — required so
 * the spawned CLI actually discovers this project's `.mcp.json`), so a
 * global-scope plugin's absolute dir has to be spelled out explicitly here
 * rather than implying a project-relative path that wouldn't actually
 * contain it. Points at the scaffolded README.md (present in every
 * complemento's own folder — see scaffoldPlugin) rather than the `plugins`
 * MCP tool's read_plugin_api_docs: that tool is only ever wired into
 * `.mcp.json` for the `claude` CLI's own MCP-client convention, unverified
 * (and unlikely) to be understood the same way by `agy` — the README works
 * for either, no MCP dependency.
 */
export function studioTerminalContext(plugin: PluginRecord): string {
  const estado = plugin.manifest.status === "published" ? "publicado" : "borrador";
  const ubicacion =
    plugin.scope === "global"
      ? `la carpeta absoluta ${plugin.dir} (es un complemento global, fuera de este proyecto)`
      : `.yggdrasil/plugins/${plugin.manifest.id}/ (relativo a la raíz de este proyecto)`;
  return (
    `Estás editando el complemento "${plugin.manifest.name}" (${estado}) del Estudio de Yggdrasil. ` +
    `Sus archivos están en ${ubicacion}. Usá tus herramientas de archivo normales ahí. ` +
    `Esa misma carpeta tiene un README.md con la referencia completa de manifest.json y del API window.ygg — leelo antes de editar. ` +
    `Los cambios se recargan solos en la vista previa — no hace falta ningún paso extra para verlos reflejados.`
  );
}

/**
 * Builds the actual spawn command/args for the chosen harness — the two
 * CLIs don't agree on how to seed context at startup (see
 * buildLaunchCommand.ts, the same asymmetry Agent Flow already lives with):
 * `claude` takes a silent `--append-system-prompt` (context only, never
 * auto-submitted as a turn); `agy` has no such flag, only `-i` ("prompt
 * interactive" — runs an initial prompt interactively then continues), so
 * for agy the context text unavoidably becomes a real, auto-submitted first
 * message instead of a quiet system prompt.
 */
export function buildStudioTerminalLaunch(
  harness: StudioTerminalHarness,
  plugin: PluginRecord,
): { command: string; args: string[] } {
  const context = studioTerminalContext(plugin);
  if (harness === "agy") return { command: "agy", args: ["-i", context] };
  return { command: "claude", args: ["--append-system-prompt", context] };
}

/**
 * Prepended to the FIRST message only of a Studio chat session (see
 * StudioChatPane.tsx's firstMessageSentRef) — `chat.send` has no per-turn
 * system-prompt-append field, so this is the only way to seed context here.
 * Unlike Terminal mode, the chat agent has no scaffold/reload MCP tools
 * (`.mcp.json` is a claude-CLI-only surface) — it only has `write_file`
 * (overwrite existing files, approval-gated every time), so the text is
 * explicit about that instead of pointing at read_plugin_api_docs's tool.
 */
export function studioChatContext(plugin: PluginRecord): string {
  const estado = plugin.manifest.status === "published" ? "publicado" : "borrador";
  const ubicacion = plugin.scope === "global" ? plugin.dir : `.yggdrasil/plugins/${plugin.manifest.id}/`;
  return (
    `[Contexto Estudio] Estás editando el complemento "${plugin.manifest.name}" (${estado}). ` +
    `Sus archivos ya existen en ${ubicacion} — usá tu herramienta de escritura de archivos con esa ruta ` +
    `(relativa a la raíz del proyecto si el scope es "project", absoluta si es "global") para editarlos. ` +
    `No hay una herramienta de scaffold ni de reload acá: los archivos ya están creados, y los cambios en ` +
    `disco se recargan solos en la vista previa. Cada escritura te va a pedir aprobación.\n\n---\n\n`
  );
}
