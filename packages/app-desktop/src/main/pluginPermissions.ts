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

/**
 * The hosts a file reaches through ygg.net.fetch: a literal URL in the call, or
 * a variable assigned a literal URL in the same file. A call whose host can't
 * be read counts as plain "net".
 */
export function netUsesIn(text: string): { permission: string; line: number }[] {
  const hostIn = (value: string): string | undefined => /^["'`]https:\/\/([A-Za-z0-9.-]+)(?=[/?#:"'`]|$)/.exec(value)?.[1]?.toLowerCase();
  const lineOf = (index: number): number => text.slice(0, index).split("\n").length;
  const assigned = new Map<string, string>();
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`]https:\/\/[^\n]*)/g)) {
    const host = hostIn(m[2]);
    if (host) assigned.set(m[1], host);
  }
  return [...text.matchAll(/ygg\.net\.fetch\s*\(\s*([^\n]*)/g)].map((m) => {
    const arg = m[1];
    const host = hostIn(arg) ?? assigned.get(/^([A-Za-z_$][\w$]*)/.exec(arg)?.[1] ?? "");
    return { permission: host ? `net:${host}` : "net", line: lineOf(m.index) };
  });
}
