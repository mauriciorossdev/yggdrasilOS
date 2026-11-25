// Pure helper behind lintPluginPermissions (plugins.ts) — kept free of
// Electron imports so it can be unit-tested.

/** Which permission a line of plugin code needs, by its ygg.* calls. */
export function permissionsUsedIn(line: string): string[] {
  const found: string[] = [];
  if (/ygg\.fs\.(list|read)\s*\(/.test(line) || line.includes("fs.changed")) found.push("fs");
  if (/ygg\.fs\.(write|mkdir)\s*\(/.test(line)) found.push("fs:write");
  if (/ygg\.panes\.\w+\s*\(/.test(line)) found.push("panes");
  for (const m of line.matchAll(/ygg\.gateway\.call\(\s*["'`]([A-Za-z0-9_.-]+)["'`]/g)) found.push(`gateway:${m[1]}`);
  return found;
}
