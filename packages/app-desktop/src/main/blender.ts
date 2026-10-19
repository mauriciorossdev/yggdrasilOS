import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { findOnPath, launchDetached, pathExists, type IdeSettings, type OpenIdeResult } from "./ideSettings.js";

function versionKey(dirName: string): number[] {
  return (dirName.match(/\d+/g) ?? []).map(Number);
}

function compareVersionsDesc(a: string, b: string): number {
  const va = versionKey(a);
  const vb = versionKey(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] ?? 0) - (va[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Newest "Blender X.Y" install under `<base>\Blender Foundation` (Windows) — null when none. */
async function newestWindowsInstall(base: string): Promise<string | null> {
  const foundation = join(base, "Blender Foundation");
  try {
    const dirs = (await readdir(foundation)).filter((d) => /^Blender/i.test(d)).sort(compareVersionsDesc);
    for (const dir of dirs) {
      const exe = join(foundation, dir, "blender.exe");
      if (await pathExists(exe)) return exe;
    }
  } catch {
    // base doesn't exist — nothing installed there
  }
  return null;
}

/** Configured path first, then standard install locations, then PATH. */
export async function locateBlender(settings: IdeSettings): Promise<string | null> {
  if (settings.blenderPath && (await pathExists(settings.blenderPath))) return settings.blenderPath;

  if (process.platform === "win32") {
    const bases = [
      process.env["ProgramFiles"] ?? "C:\\Program Files",
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      join(process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"), "Programs"),
    ];
    for (const base of bases) {
      const found = await newestWindowsInstall(base);
      if (found) return found;
    }
    for (const steam of [
      "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender\\blender.exe",
      "C:\\Program Files\\Steam\\steamapps\\common\\Blender\\blender.exe",
    ]) {
      if (await pathExists(steam)) return steam;
    }
  } else if (process.platform === "darwin") {
    for (const app of ["/Applications/Blender.app", join(homedir(), "Applications", "Blender.app")]) {
      if (await pathExists(app)) return app;
    }
  }
  return findOnPath("blender");
}

export async function openInBlender(absolutePath: string, settings: IdeSettings): Promise<OpenIdeResult> {
  const blender = await locateBlender(settings);
  if (!blender) {
    return { opened: false, error: "Blender not found. Set its path in Settings → IDE → Blender." };
  }
  if (process.platform === "darwin" && blender.endsWith(".app")) launchDetached("open", ["-a", blender, absolutePath]);
  else launchDetached(blender, [absolutePath]);
  return { opened: true };
}
