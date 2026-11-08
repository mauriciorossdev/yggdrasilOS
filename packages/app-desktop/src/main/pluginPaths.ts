const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");

/**
 * True for a bundled-plugins dir of *some* Yggdrasil desktop install: a
 * packaged app's `.../resources/app/node_modules/@yggdrasil` (macOS
 * `.app/Contents/Resources/app`, Windows/Linux `resources/app`) or a dev
 * checkout's `packages/app-desktop/node_modules/@yggdrasil`.
 */
export function isDesktopPluginDir(path: string): boolean {
  const p = norm(path);
  if (!p.endsWith("/node_modules/@yggdrasil")) return false;
  return /\/Contents\/Resources\/app\/node_modules\/@yggdrasil$/i.test(p)
    || /\/resources\/app(\.asar\.unpacked)?\/node_modules\/@yggdrasil$/i.test(p)
    || /\/packages\/app-desktop\/node_modules\/@yggdrasil$/.test(p);
}

/**
 * Plugin search paths with every *other* install's bundled dir dropped and
 * `current` present. Those dirs carry native modules (better-sqlite3, ...)
 * built for that install's Electron ABI; a stale one listed ahead of
 * `current` (project last opened from a packaged app, now run from dev, or
 * vice versa) wins plugin discovery and crashes the gateway on boot.
 */
export function reconcilePluginPaths(existing: string[], current: string): string[] {
  const kept = existing.filter((p) => norm(p) === norm(current) || !isDesktopPluginDir(p));
  return kept.some((p) => norm(p) === norm(current)) ? kept : [...kept, current];
}
