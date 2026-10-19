import { spawn } from "node:child_process";
import { platform, homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineTool } from "@yggdrasil/tools-sdk";

type DesktopProjectRecord = { id: string; name: string; path: string };

/**
 * Electron turns a scoped package name ("@yggdrasil/app-desktop") into two
 * nested path segments for its default userData folder — verified against a
 * real dev install rather than app-desktop's own explicit naming (it has
 * none). This tool runs in the gateway subprocess (plain Node, no Electron),
 * so the path is re-derived by hand instead of via app.getPath().
 */
function desktopAppDataDir(): string {
  switch (platform()) {
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "@yggdrasil", "app-desktop");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "@yggdrasil", "app-desktop");
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "@yggdrasil", "app-desktop");
  }
}

async function listDesktopProjects(): Promise<DesktopProjectRecord[]> {
  try {
    const raw = await readFile(join(desktopAppDataDir(), "projects.json"), "utf8");
    return JSON.parse(raw) as DesktopProjectRecord[];
  } catch {
    return [];
  }
}

function openUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const os = platform();
    const [cmd, args] =
      os === "win32" ? ["cmd", ["/c", "start", "", url]] : os === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", reject);
    child.unref();
    resolve();
  });
}

export const listDesktopProjectsTool = defineTool({
  name: "list_desktop_projects",
  description:
    "Lists every project known to Yggdrasil Desktop (name + id), so the user can be told what's available or pick one to open with open_desktop_project. Use this whenever the user asks what projects exist/are available — there's no other way to enumerate them.",
  riskLevel: "safe",
  parameters: { type: "object", properties: {} },
  async execute() {
    const projects = await listDesktopProjects();
    return { projects: projects.map((p) => ({ name: p.name, id: p.id })) };
  },
});

export const openDesktopProjectTool = defineTool({
  name: "open_desktop_project",
  description:
    "Opens the Yggdrasil Desktop app, jumping straight to a named project if given, or to its main view otherwise. Use when the user asks (by voice or text) to open/switch to/go to Yggdrasil Desktop, or to a named project inside it — not open_path, which only opens a folder in the OS file manager.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      projectName: {
        type: "string",
        description:
          "Name of the project to open, matched case-insensitively against Yggdrasil Desktop's known projects. Omit to just bring the app to its main view.",
      },
    },
  },
  async execute(_ctx, args) {
    const projectName = args.projectName ? String(args.projectName).trim() : "";
    if (!projectName) {
      await openUrl("yggdrasil://open-project");
      return { opened: "main view" };
    }

    const projects = await listDesktopProjects();
    const needle = projectName.toLowerCase();
    const exact = projects.filter((p) => p.name.toLowerCase() === needle);
    const matches = exact.length ? exact : projects.filter((p) => p.name.toLowerCase().includes(needle));

    if (matches.length === 1) {
      await openUrl(`yggdrasil://open-project?id=${encodeURIComponent(matches[0]!.id)}`);
      return { opened: matches[0]!.name };
    }
    if (matches.length > 1) {
      return { opened: false, reason: "ambiguous project name — ask the user which one", matches: matches.map((p) => p.name) };
    }
    return {
      opened: false,
      reason: "no project matched that name",
      knownProjects: projects.map((p) => p.name),
    };
  },
});
