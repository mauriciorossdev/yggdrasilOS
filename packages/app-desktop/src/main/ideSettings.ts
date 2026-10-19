import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

const execFileAsync = promisify(execFile);

export type IdeCatalogEntry = {
  id: string;
  label: string;
  /** PATH binary name to look up via `which`/`where` — e.g. "code" for VS Code. */
  cliCommand?: string;
  /** macOS app bundle basename under /Applications or ~/Applications, used as a fallback when the CLI shim isn't installed. */
  macApp?: string;
};

// A curated set of common editors/IDEs used for coding-agent work — not
// exhaustive. Anything missing here is still reachable via the "custom"
// entry (IdeSettings.configuredId === "custom"), where the user browses
// directly to an executable or (on macOS) an .app bundle.
export const IDE_CATALOG: IdeCatalogEntry[] = [
  { id: "vscode", label: "Visual Studio Code", cliCommand: "code", macApp: "Visual Studio Code.app" },
  { id: "cursor", label: "Cursor", cliCommand: "cursor", macApp: "Cursor.app" },
  { id: "windsurf", label: "Windsurf", cliCommand: "windsurf", macApp: "Windsurf.app" },
  { id: "zed", label: "Zed", cliCommand: "zed", macApp: "Zed.app" },
  { id: "sublime", label: "Sublime Text", cliCommand: "subl", macApp: "Sublime Text.app" },
  { id: "webstorm", label: "WebStorm", cliCommand: "webstorm", macApp: "WebStorm.app" },
  { id: "idea", label: "IntelliJ IDEA", cliCommand: "idea", macApp: "IntelliJ IDEA.app" },
  { id: "pycharm", label: "PyCharm", cliCommand: "pycharm", macApp: "PyCharm.app" },
  { id: "androidstudio", label: "Android Studio", cliCommand: "studio", macApp: "Android Studio.app" },
];

export type DetectedIde = {
  id: string;
  label: string;
  installed: boolean;
  launchKind?: "cli" | "app";
  /** The resolved CLI binary or .app bundle path this entry would actually be launched with. */
  launchPath?: string;
};

export type IdeSettings = {
  /** IDE_CATALOG id, "custom", or null (unconfigured — the IDE button falls back to opening Settings). */
  configuredId: string | null;
  /** "custom" only — display label for the manually-picked IDE. */
  customLabel?: string;
  /** "custom" only — an executable path, or (macOS) an .app bundle path. */
  customPath?: string;
  /** Explicit blender executable (or .app); when unset blender.ts autodetects one. */
  blenderPath?: string;
};

export function defaultIdeSettings(): IdeSettings {
  return { configuredId: null };
}

/** desktop-settings.json also holds ide's settings (nested under "ide") — see settingsFile.ts's shared write queue. */
export async function loadIdeSettings(userDataDir: string): Promise<IdeSettings> {
  const defaults = defaultIdeSettings();
  const raw = await readSettingsFile(userDataDir);
  return { ...defaults, ...((raw as { ide?: Partial<IdeSettings> }).ide ?? {}) };
}

export async function saveIdeSettings(userDataDir: string, settings: IdeSettings): Promise<void> {
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, ide: settings }));
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * A GUI app launched from Finder/Dock only sees macOS's minimal
 * LaunchServices PATH unless resolveShellPath.ts's fix has already run (it
 * has, by the time any of this is called — see main/index.ts's app.whenReady)
 * — so a plain `which`/`where` here does see nvm/Homebrew-installed CLI shims
 * the same way a real terminal would.
 */
export async function findOnPath(cliCommand: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(process.platform === "win32" ? "where" : "which", [cliCommand]);
    const lines = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    // `where code` lists the extensionless sh shim first (...\bin\code), which
    // Windows can't spawn — prefer a real .exe/.cmd/.bat entry.
    if (process.platform === "win32") {
      return lines.find((l) => /\.(exe|cmd|bat)$/i.test(l)) ?? null;
    }
    return lines[0] ?? null;
  } catch {
    return null;
  }
}

async function findMacApp(bundleName: string): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  for (const dir of ["/Applications", join(homedir(), "Applications")]) {
    const candidate = join(dir, bundleName);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function locate(entry: IdeCatalogEntry): Promise<{ launchKind: "cli" | "app"; launchPath: string } | null> {
  if (entry.cliCommand) {
    const cliPath = await findOnPath(entry.cliCommand);
    if (cliPath) return { launchKind: "cli", launchPath: cliPath };
  }
  if (entry.macApp) {
    const appPath = await findMacApp(entry.macApp);
    if (appPath) return { launchKind: "app", launchPath: appPath };
  }
  return null;
}

export async function detectInstalledIdes(): Promise<DetectedIde[]> {
  return Promise.all(
    IDE_CATALOG.map(async (entry) => {
      const found = await locate(entry);
      return found
        ? { id: entry.id, label: entry.label, installed: true, ...found }
        : { id: entry.id, label: entry.label, installed: false };
    }),
  );
}

export function launchDetached(command: string, args: string[]): void {
  // Node refuses to spawn .cmd/.bat directly on Windows (EINVAL since the
  // CVE-2024-27980 fix) — those need a shell, with args quoted by hand.
  const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const child = needsShell
    ? spawn(`"${command}"`, args.map((a) => `"${a}"`), { detached: true, stdio: "ignore", shell: true, windowsHide: true })
    : spawn(command, args, { detached: true, stdio: "ignore" });
  // Without this, a stale/uninstalled target (ENOENT) throws an unhandled
  // "error" event and crashes the main process — fire-and-forget is
  // otherwise fine here, same posture as terminals.ts's own spawns.
  child.on("error", (err) => console.error("[ide] failed to launch", command, err));
  child.unref();
}

export type OpenIdeResult = { opened: boolean; error?: string };

export async function openProjectInIde(projectPath: string, settings: IdeSettings): Promise<OpenIdeResult> {
  if (!settings.configuredId) return { opened: false };

  if (settings.configuredId === "custom") {
    if (!settings.customPath) return { opened: false, error: "No custom IDE path configured." };
    if (process.platform === "darwin" && settings.customPath.endsWith(".app")) {
      launchDetached("open", ["-a", settings.customPath, projectPath]);
    } else {
      launchDetached(settings.customPath, [projectPath]);
    }
    return { opened: true };
  }

  const entry = IDE_CATALOG.find((e) => e.id === settings.configuredId);
  if (!entry) return { opened: false, error: "Configured IDE is no longer recognized." };

  const found = await locate(entry);
  if (!found) return { opened: false, error: `${entry.label} doesn't seem to be installed anymore.` };

  if (found.launchKind === "app") launchDetached("open", ["-a", found.launchPath, projectPath]);
  else launchDetached(found.launchPath, [projectPath]);
  return { opened: true };
}
