import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { watch as watchFsSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { PLUGIN_API_DOCS } from "./pluginApiDocs.js";

/**
 * A "complemento": a folder with manifest.json + HTML/JS/CSS, loaded in a
 * sandboxed iframe via the ygg-plugin:// protocol (see pluginProtocol.ts).
 * `views` controls where it can be opened — MainTabs (a pestaña), the
 * file-content-panel aside (a panel), and/or the mobile app's own
 * Complementos tab ("mobile" — rendered there via a project-scoped
 * fs.read of this same folder, see mobile/app/lib/plugins/; desktop code
 * never does anything with that value beyond carrying it through) — an
 * agent-authored manifest declares whichever it wants.
 */
export type PluginView = "tab" | "panel" | "mobile";

/**
 * "fs" and "fs:write" gate the plugin's own project-fs access (see
 * pluginHost.ts); "panes" gates spawning/writing terminal panes; a
 * `gateway:<method>` string gates one exact gateway RPC method by name (e.g.
 * "gateway:chat.send") — see pluginHost.ts's run() switch for where each is
 * actually enforced. Kept as `string` (not a closed union) so an unknown
 * future permission a manifest declares is preserved rather than rejected at
 * parse time; only known permissions ever unlock anything.
 */
export type PluginPermission = "fs" | "fs:write" | "panes" | string;

/**
 * A named, described, JSON-Schema-typed function a plugin registers a real
 * handler for at runtime (`ygg.tools.register`, see pluginSdk.ts) and that
 * becomes callable from outside the plugin's own UI — a `claude`/`agy`
 * terminal session in the project sees it as its own MCP tool (see
 * pluginsControlMcpShim.ts), dynamically, once the plugin is published.
 */
export type PluginToolDef = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
};

/** Absent (undefined) is treated as "published" everywhere — full back-compat with every manifest written before Studio existed. Only Studio's own scaffold flow ever writes "draft"; the MCP scaffold_plugin tool's manifests stay unset/published exactly as before. */
export type PluginStatus = "draft" | "published";

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  /** An emoji/short text (rendered directly), or a relative file (e.g. "icon.png", served via the same ygg-plugin:// URL as the rest of the plugin) — PluginsSection tells the two apart by checking for a ".". */
  icon?: string;
  /** Relative to the plugin's own folder, no "..". Defaults to "index.html". */
  entry?: string;
  views: PluginView[];
  defaultView?: PluginView;
  permissions?: PluginPermission[];
  /** px hint applied as min-height when opened as an aside panel. */
  minHeight?: number;
  status?: PluginStatus;
  /** Functions this plugin exposes to the rest of the project — see PluginToolDef. Absent/empty means it exposes none (fine — most complementos are pure UI). */
  tools?: PluginToolDef[];
};

export type PluginScope = "global" | "project";

export type PluginRecord = {
  /** "<scope>:<id>" — global and project plugins can share the same id without colliding; see the plan doc's "Identity decision". */
  key: string;
  scope: PluginScope;
  manifest: PluginManifest;
  dir: string;
  /** Base ygg-plugin:// URL for this plugin's entry file — empty when `error` is set (broken manifest, nothing servable). */
  url: string;
  /** Set when the manifest failed to parse/validate — the record still appears (as broken) instead of silently vanishing, so the sidebar can tell the user/agent something is wrong. */
  error?: string;
};

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
/** A declared tool's own name — kept separately constrained (not reusing PLUGIN_ID_RE) because it ends up half of an MCP tool name (`${scope}-${id}__${tool}`, see pluginsControlMcpShim.ts) built from caller-controlled manifest text; must stay ASCII-safe for that regardless of what PLUGIN_ID_RE allows. */
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function globalPluginsDir(): string {
  return join(app.getPath("userData"), "plugins");
}

export function projectPluginsDir(projectPath: string): string {
  return join(projectPath, ".yggdrasil", "plugins");
}

/** Called on every project open (and once at startup for the global dir) so a watcher always has a real directory to attach to, even before any plugin has ever been created. */
export async function ensurePluginDirs(projectPath?: string): Promise<void> {
  await mkdir(globalPluginsDir(), { recursive: true }).catch(() => {});
  if (projectPath) await mkdir(projectPluginsDir(projectPath), { recursive: true }).catch(() => {});
}

function pluginUrl(scope: PluginScope, projectId: string | undefined, id: string): string {
  return scope === "global" ? `ygg-plugin://plugin/global/${id}/` : `ygg-plugin://plugin/project/${projectId}/${id}/`;
}

function placeholderManifest(id: string): PluginManifest {
  return { id, name: id, version: "0.0.0", views: [] };
}

async function readManifest(dir: string): Promise<PluginManifest> {
  const raw = await readFile(join(dir, "manifest.json"), "utf8");
  const parsed = JSON.parse(raw) as Partial<PluginManifest>;
  if (!parsed.id || typeof parsed.id !== "string" || !PLUGIN_ID_RE.test(parsed.id)) {
    throw new Error("manifest.json: \"id\" ausente o inválido (minúsculas/números/guiones, máx 64)");
  }
  if (!parsed.name || typeof parsed.name !== "string") {
    throw new Error('manifest.json: "name" ausente');
  }
  if (!Array.isArray(parsed.views) || parsed.views.length === 0) {
    throw new Error('manifest.json: "views" ausente (usar ["tab"], ["panel"], ["mobile"] o combinación)');
  }
  for (const v of parsed.views) {
    if (v !== "tab" && v !== "panel" && v !== "mobile") throw new Error(`manifest.json: vista inválida "${String(v)}"`);
  }
  return {
    id: parsed.id,
    name: parsed.name,
    version: typeof parsed.version === "string" && parsed.version ? parsed.version : "0.0.0",
    icon: typeof parsed.icon === "string" ? parsed.icon : undefined,
    entry: typeof parsed.entry === "string" && parsed.entry ? parsed.entry : "index.html",
    views: parsed.views as PluginView[],
    defaultView: parsed.defaultView === "panel" ? "panel" : parsed.defaultView === "tab" ? "tab" : undefined,
    permissions: Array.isArray(parsed.permissions) ? parsed.permissions.filter((p) => typeof p === "string") : [],
    minHeight: typeof parsed.minHeight === "number" ? parsed.minHeight : undefined,
    status: parsed.status === "draft" ? "draft" : parsed.status === "published" ? "published" : undefined,
    tools: Array.isArray(parsed.tools)
      ? parsed.tools.flatMap((t): PluginToolDef[] => {
          if (!t || typeof t !== "object") return [];
          const name = (t as Partial<PluginToolDef>).name;
          const description = (t as Partial<PluginToolDef>).description;
          if (typeof name !== "string" || !TOOL_NAME_RE.test(name) || typeof description !== "string") {
            console.warn(`manifest.json: tool inválido ignorado en "${dir}"`, t);
            return [];
          }
          const rawSchema = (t as Partial<PluginToolDef>).inputSchema;
          const inputSchema =
            rawSchema && typeof rawSchema === "object" ? rawSchema : { type: "object", properties: {}, required: [] };
          return [{ name, description, inputSchema }];
        })
      : [],
  };
}

async function scanDir(scope: PluginScope, dir: string, projectId?: string): Promise<PluginRecord[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const records: PluginRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const key = `${scope}:${id}`;
    const dirPath = join(dir, id);
    if (!PLUGIN_ID_RE.test(id)) {
      records.push({ key, scope, manifest: placeholderManifest(id), dir: dirPath, url: "", error: "nombre de carpeta inválido" });
      continue;
    }
    try {
      const manifest = await readManifest(dirPath);
      if (manifest.id !== id) throw new Error('manifest.json: "id" debe coincidir con el nombre de la carpeta');
      records.push({ key, scope, manifest, dir: dirPath, url: pluginUrl(scope, projectId, id) });
    } catch (err) {
      records.push({
        key,
        scope,
        manifest: placeholderManifest(id),
        dir: dirPath,
        url: "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return records;
}

/** Project plugins first (more specific to what the user's looking at), then global. */
export async function scanPlugins(projectId: string, projectPath: string): Promise<PluginRecord[]> {
  const [project, global] = await Promise.all([
    scanDir("project", projectPluginsDir(projectPath), projectId),
    scanDir("global", globalPluginsDir()),
  ]);
  return [...project, ...global];
}

export type PluginWatchHandle = { close(): void };

/**
 * Watches a plugins root (global or one project's) for any change and calls
 * back with the first path segment under it (the plugin id) — debounced so
 * an editor's atomic save (unlink+rename, several fs events in a burst)
 * collapses into one notification. `fs.watch`'s recursive option (not
 * chokidar — unavailable from this package, see the plan doc) is native on
 * macOS/Windows and, as of the Node 22 runtime Electron 33 bundles,
 * supported on Linux too.
 */
export function watchPluginsDir(dir: string, onChange: (pluginId: string) => void): PluginWatchHandle {
  let watcher: FSWatcher | undefined;
  let closed = false;
  const timers = new Map<string, NodeJS.Timeout>();
  let retryTimer: NodeJS.Timeout | undefined;

  function scheduleChange(pluginId: string): void {
    const existing = timers.get(pluginId);
    if (existing) clearTimeout(existing);
    timers.set(
      pluginId,
      setTimeout(() => {
        timers.delete(pluginId);
        onChange(pluginId);
      }, 300),
    );
  }

  function arm(): void {
    if (closed) return;
    try {
      watcher = watchFsSync(dir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const pluginId = filename.split(/[\\/]/)[0];
        if (pluginId) scheduleChange(pluginId);
      });
      watcher.on("error", () => {
        // The directory itself was likely removed — close and retry shortly
        // so recreating it (e.g. the app re-seeding it on next project open)
        // is picked back up without a restart.
        watcher?.close();
        watcher = undefined;
        retryTimer = setTimeout(arm, 1000);
      });
    } catch {
      retryTimer = setTimeout(arm, 1000);
    }
  }

  arm();

  return {
    close() {
      closed = true;
      watcher?.close();
      if (retryTimer) clearTimeout(retryTimer);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}

export type ScaffoldPluginSpec = {
  id: string;
  name: string;
  icon?: string;
  scope?: PluginScope;
  views?: PluginView[];
  defaultView?: PluginView;
  permissions?: PluginPermission[];
  /** Free-form — dropped into the scaffolded README's opening line, purely descriptive. */
  description?: string;
  /** Undefined (the MCP scaffold_plugin tool's default) means published, same as ever — only Studio's own IPC handler passes "draft" explicitly here. */
  status?: PluginStatus;
};

function starterIndexHtml(name: string): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${name}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main id="app">Cargando…</main>
    <script src="ygg-plugin://sdk/ygg.js"></script>
    <script src="app.js"></script>
  </body>
</html>
`;
}

/**
 * Registers the starter "ping" tool BEFORE the `await ygg.ready()` below,
 * synchronously at load — a toolcall can arrive the instant `ygg:ready`
 * fires (see PluginFrame.tsx's readiness tracking), so registration can't
 * be deferred behind that same promise. Real, callable from the moment the
 * plugin is scaffolded — not a commented-out example — per this feature's
 * whole point: every complemento is built with a tool to expose from day one.
 */
function starterAppJs(id: string): string {
  return `// Ver README.md (o ygg.app.info / read_plugin_api_docs) para la referencia completa de window.ygg.
ygg.tools.register("ping", async () => ({ ok: true, plugin: "${id}", message: "pong" }));

(async function () {
  const info = await ygg.ready();
  document.getElementById("app").textContent = "Complemento \\"" + info.plugin.name + "\\" listo.";
})();
`;
}

const STARTER_STYLES_CSS = `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #14161a;
  color: #e6e6e6;
}

#app {
  padding: 16px;
}
`;

/** Creates a plugin's folder + manifest + starter index.html/app.js/styles.css/README.md — the scaffold_plugin MCP tool's implementation (see pluginsControlMcpShim.ts). */
export async function scaffoldPlugin(
  spec: ScaffoldPluginSpec,
  projectId: string,
  projectPath: string,
): Promise<PluginRecord> {
  if (!spec.id || !PLUGIN_ID_RE.test(spec.id)) {
    throw new Error('"id" inválido — minúsculas/números/guiones/guiones bajos, máx 64 caracteres');
  }
  if (!spec.name || !spec.name.trim()) throw new Error('"name" es requerido');

  const scope: PluginScope = spec.scope === "global" ? "global" : "project";
  const dir = scope === "global" ? join(globalPluginsDir(), spec.id) : join(projectPluginsDir(projectPath), spec.id);

  const alreadyExists = await stat(dir)
    .then(() => true)
    .catch(() => false);
  if (alreadyExists) throw new Error(`ya existe un complemento "${spec.id}" en scope "${scope}" (${dir})`);

  await mkdir(dir, { recursive: true });

  const manifest: PluginManifest = {
    id: spec.id,
    name: spec.name.trim(),
    version: "0.1.0",
    icon: spec.icon,
    entry: "index.html",
    views: spec.views && spec.views.length > 0 ? spec.views : ["tab"],
    defaultView: spec.defaultView,
    permissions: spec.permissions ?? [],
    status: spec.status,
    tools: [
      {
        name: "ping",
        description: "Responde pong — ejemplo de tool registrada, reemplazala o ampliala según lo que haga el complemento.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],
  };

  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(join(dir, "index.html"), starterIndexHtml(manifest.name), "utf8");
  await writeFile(join(dir, "app.js"), starterAppJs(spec.id), "utf8");
  await writeFile(join(dir, "styles.css"), STARTER_STYLES_CSS, "utf8");
  await writeFile(
    join(dir, "README.md"),
    `# ${manifest.name}\n\n${spec.description ? `${spec.description}\n\n` : ""}${PLUGIN_API_DOCS}`,
    "utf8",
  );

  return { key: `${scope}:${spec.id}`, scope, manifest, dir, url: pluginUrl(scope, projectId, spec.id) };
}

/** Flips a plugin's draft/published status by rewriting its manifest.json — the Studio "Publicar" action. watchPluginsDir's own hot-reload already picks up the rewrite (any file change re-scans), this just also returns the fresh record so the caller can broadcast plugins:changed for immediate feedback ahead of the watcher's debounce. */
export async function setPluginStatus(
  scope: PluginScope,
  id: string,
  projectId: string,
  projectPath: string,
  status: PluginStatus,
): Promise<PluginRecord> {
  const dir = scope === "global" ? join(globalPluginsDir(), id) : join(projectPluginsDir(projectPath), id);
  const manifest = await readManifest(dir);
  if (manifest.id !== id) throw new Error('manifest.json: "id" debe coincidir con el nombre de la carpeta');
  const next: PluginManifest = { ...manifest, status };
  await writeFile(join(dir, "manifest.json"), JSON.stringify(next, null, 2), "utf8");
  return { key: `${scope}:${id}`, scope, manifest: next, dir, url: pluginUrl(scope, projectId, id) };
}

/** Deletes a plugin's whole folder — the Studio "Eliminar" action. `dir` is always built from the two known plugin roots + a regex-validated id (never from an unconfined caller-supplied path), same confinement posture as scaffoldPlugin/scanDir. */
export async function deletePlugin(scope: PluginScope, id: string, projectPath: string): Promise<void> {
  if (!PLUGIN_ID_RE.test(id)) throw new Error('"id" inválido');
  const dir = scope === "global" ? join(globalPluginsDir(), id) : join(projectPluginsDir(projectPath), id);
  await rm(dir, { recursive: true, force: true });
}
