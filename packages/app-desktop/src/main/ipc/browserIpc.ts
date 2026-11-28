// IPC for the Browser tab and for review comments on code.
import { ipcMain } from "electron";
import type { CommentProvider } from "../browserCommentsHost.js";
import { type BrowserTabBounds, type BrowserTabHandle, scaleBrowserTabBounds } from "../browserTabView.js";
import type { CodeCommentsHost } from "../codeCommentsHost.js";
import { scanLocalPorts } from "../localPorts.js";

type Deps = {
  resolveBrowserTab: (projectId: string) => BrowserTabHandle | undefined;
  projectWindows: ReadonlyMap<string, { browserTab?: BrowserTabHandle }>;
  commentPaneTitles: Map<string, Record<string, string>>;
  commentProviders: Map<string, CommentProvider[]>;
  codeCommentsHostFor: (projectId: string) => CodeCommentsHost;
};

export function registerBrowserIpc({ resolveBrowserTab, projectWindows, commentPaneTitles, commentProviders, codeCommentsHostFor }: Deps): void {
  // Browser tab (BrowserTabView.tsx) — a WebContentsView is a native layer
  // Electron composites into the window, not a DOM node, so the renderer
  // can only ever ask for it to navigate/reposition/show/hide, never render
  // it directly. `navigate`/`show` lazily create the view (most projects
  // never touch this tab); `hide`/`getUrl` read the existing entry directly
  // instead, since there'd be nothing useful to lazily create just to hide.
  ipcMain.handle("browserTab:navigate", async (_event, projectId: string, url: string) => {
    await resolveBrowserTab(projectId)?.navigate(url);
  });
  // Address-bar navigation: URL-or-search, errors land in browserTab:state
  // rather than rejecting here (agent-driven browser_open keeps the strict
  // `navigate` above).
  ipcMain.handle("browserTab:go", async (_event, projectId: string, input: string) => {
    await resolveBrowserTab(projectId)?.go(input);
  });
  ipcMain.handle("browserTab:newTab", async (_event, projectId: string, input?: string) => {
    return (await resolveBrowserTab(projectId)?.newTab(input)) ?? null;
  });
  ipcMain.handle("browserTab:closeTab", (_event, projectId: string, id: string) => {
    projectWindows.get(projectId)?.browserTab?.closeTab(id);
  });
  ipcMain.handle("browserTab:activateTab", (_event, projectId: string, id: string) => {
    projectWindows.get(projectId)?.browserTab?.activateTab(id);
  });
  ipcMain.handle("browserTab:toggleDevTools", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.toggleDevTools();
  });
  ipcMain.handle("browserTab:zoom", (_event, projectId: string, direction: "in" | "out" | "reset") => {
    projectWindows.get(projectId)?.browserTab?.zoom(direction);
  });
  ipcMain.handle("browserTab:showDownload", (_event, projectId: string, path: string) => {
    projectWindows.get(projectId)?.browserTab?.showDownload(path);
  });
  // Which common dev-server ports are listening on this machine (the empty
  // Browser tab offers them as one-click links). Not per project.
  ipcMain.handle("browserTab:scanPorts", () => scanLocalPorts());
  ipcMain.handle("browserTab:back", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.back();
  });
  ipcMain.handle("browserTab:forward", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.forward();
  });
  ipcMain.handle("browserTab:reload", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.reload();
  });
  ipcMain.handle("browserTab:stop", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.stop();
  });
  ipcMain.handle("browserTab:getState", (_event, projectId: string) => projectWindows.get(projectId)?.browserTab?.getState() ?? null);
  ipcMain.handle("browserTab:setBounds", (event, projectId: string, bounds: BrowserTabBounds) => {
    resolveBrowserTab(projectId)?.setBounds(scaleBrowserTabBounds(bounds, event.sender.getZoomFactor()));
  });
  ipcMain.handle("browserTab:show", (_event, projectId: string) => {
    resolveBrowserTab(projectId)?.show();
  });
  ipcMain.handle("browserTab:hide", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.hide();
  });
  // Still image of the active page, for the renderer to show in the viewport
  // placeholder while the native view is temporarily hidden (a DOM flyout
  // can't draw over a WebContentsView). null on any failure: the caller just
  // falls back to hiding the view without a placeholder.
  ipcMain.handle("browserTab:snapshot", async (_event, projectId: string) => {
    try {
      const shot = await projectWindows.get(projectId)?.browserTab?.screenshot();
      return shot ? { base64: shot.base64, mimeType: shot.mimeType } : null;
    } catch {
      return null;
    }
  });
  ipcMain.handle("browserTab:getUrl", (_event, projectId: string) => projectWindows.get(projectId)?.browserTab?.getUrl() ?? "");
  // Blocks until the user clicks something in the loaded page (or Escape /
  // timeout) — see browserTabView.ts's startPick and
  // browserTabPickerPreload.ts's overlay. Same method backs both the
  // renderer's own "Pick element" button and paneControlServer.ts's
  // agent-callable /browser/pick.
  ipcMain.handle("browserTab:startPick", async (_event, projectId: string, timeoutMs?: number) => {
    return (await resolveBrowserTab(projectId)?.startPick(timeoutMs)) ?? null;
  });
  // Toolbar 💬 toggle → the active page's comment mode (the page's own overlay
  // handles the clicking); providers feed the in-page "New agent" popover.
  ipcMain.handle("browserTab:comments:setMode", (_event, projectId: string, on: boolean) => {
    projectWindows.get(projectId)?.browserTab?.setCommentMode(Boolean(on));
  });
  ipcMain.handle("browserTab:comments:setPaneTitles", (_event, projectId: string, titles: Record<string, string>) => {
    const clean: Record<string, string> = {};
    for (const [id, title] of Object.entries(titles ?? {})) if (typeof title === "string") clean[id] = title;
    commentPaneTitles.set(projectId, clean);
  });
  ipcMain.handle("browserTab:comments:setProviders", (_event, projectId: string, providers: CommentProvider[]) => {
    commentProviders.set(
      projectId,
      (Array.isArray(providers) ? providers : []).map((p) => ({
        id: String(p.id),
        label: String(p.label),
        command: String(p.command),
      })),
    );
  });
  // Review comments on code: diffs and the file editor (codeCommentsHost.ts).
  ipcMain.handle("codeComments:locate", (_e, projectId: string, target: string) => codeCommentsHostFor(projectId).locate(String(target)));
  ipcMain.handle("codeComments:list", (_e, projectId: string, root: string) => codeCommentsHostFor(projectId).list(root));
  ipcMain.handle("codeComments:add", (_e, projectId: string, root: string, input: unknown) => codeCommentsHostFor(projectId).add(root, input));
  ipcMain.handle("codeComments:update", (_e, projectId: string, root: string, id: string, text: string) =>
    codeCommentsHostFor(projectId).update(root, id, text),
  );
  ipcMain.handle("codeComments:remove", (_e, projectId: string, root: string, id: string) => codeCommentsHostFor(projectId).remove(root, id));
  ipcMain.handle("codeComments:clearDone", (_e, projectId: string, root: string) => codeCommentsHostFor(projectId).clearDone(root));
  ipcMain.handle("codeComments:setStatus", (_e, projectId: string, ids: string[], status: "idle" | "sent" | "done") =>
    codeCommentsHostFor(projectId).setStatus(Array.isArray(ids) ? ids : [], status),
  );
  ipcMain.handle("codeComments:dropRoot", (_e, projectId: string, path: string) => codeCommentsHostFor(projectId).dropRoot(path));
  ipcMain.handle("codeComments:targets", (_e, projectId: string) => codeCommentsHostFor(projectId).targets());
  ipcMain.handle("codeComments:send", (_e, projectId: string, req: Parameters<CodeCommentsHost["send"]>[0]) =>
    codeCommentsHostFor(projectId).send(req),
  );
}
