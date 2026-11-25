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
  /** The user's first message (a new complemento's description) — submitted as the session's first turn. */
  initialPrompt?: string,
): { command: string; args: string[] } {
  const context = studioTerminalContext(plugin);
  if (harness === "agy") return { command: "agy", args: ["-i", initialPrompt ? `${context}\n\n${initialPrompt}` : context] };
  // claude: context stays a silent system-prompt append; a positional
  // prompt starts the interactive session with that message already sent.
  const args = ["--append-system-prompt", context];
  if (initialPrompt) args.push(initialPrompt);
  return { command: "claude", args };
}

/**
 * First message for a complemento just created from a description in
 * StudioNew: what the user asked for, the chosen template's hint, and a
 * nudge to start editing right away (the scaffold is only a placeholder).
 */
export function studioInitialPrompt(description: string, templateHint?: string): string {
  const parts = [description.trim()];
  if (templateHint) parts.push(templateHint);
  parts.push(
    "Los archivos de arranque son solo un placeholder: reemplazalos para que el complemento haga esto. " +
      "Si necesitás otro permiso o vista, decímelo para cambiarlo en Ajustes.",
  );
  return parts.filter(Boolean).join("\n\n");
}

/**
 * "Pedir arreglo al agente" from a console error. One line on purpose: in a
 * terminal, a newline would submit the message early.
 */
export function studioFixRequest(message: string, stack?: string): string {
  const where = stack?.split("\n").find((l) => l.trim())?.trim();
  return `La vista previa del complemento tira este error: ${message}${where && where !== message ? ` (${where})` : ""}. Encontrá la causa y arreglalo.`;
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

/** The glyph shown for a complemento in the Estudio: its manifest emoji icon, else the first letter of its name (an icon that names a file isn't rendered here). */
export function pluginGlyph(plugin: PluginRecord): string {
  const icon = plugin.manifest.icon;
  if (icon && !icon.includes(".")) return icon;
  return (plugin.manifest.name.trim()[0] ?? "?").toUpperCase();
}
