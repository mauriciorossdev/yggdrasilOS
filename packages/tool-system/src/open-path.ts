import { spawn } from "node:child_process";
import { platform } from "node:os";
import { defineTool } from "@yggdrasil/tools-sdk";

function openerCommand(): string {
  if (platform() === "win32") return "explorer.exe";
  if (platform() === "darwin") return "open";
  return "xdg-open";
}

export const openPathTool = defineTool({
  name: "open_path",
  description:
    "Opens a file or folder in the OS's default file manager/app (e.g. File Explorer on Windows) so the user can see it themselves. Use this when the user asks to open/show/browse a folder or file — not list_directory, which only returns a text listing without opening anything.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or folder path to open (relative to cwd or absolute)" },
    },
    required: ["path"],
  },
  async execute(_ctx, args) {
    const path = String(args.path ?? "");
    await new Promise<void>((resolve, reject) => {
      // explorer.exe's own exit code is unreliable (often nonzero even when
      // it opened fine) — spawning without an error event is the real
      // success signal here, not the child's eventual exit code.
      const child = spawn(openerCommand(), [path], { detached: true, stdio: "ignore" });
      child.on("error", reject);
      child.unref();
      resolve();
    });
    return { path, opened: true };
  },
});
