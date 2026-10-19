import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import type { ProjectRecord } from "./projects.js";

/**
 * Builds the project-file URL the renderer feeds to <audio>/three loaders:
 *   ygg-file://f/<projectId>/<relativePath>
 * The project id lives in the path (not the host) because standard-scheme
 * hostnames are lowercased. Sibling files (glTF .bin, textures, OBJ .mtl)
 * resolve naturally against this URL.
 */
export function registerFileProtocol(getProject: (id: string) => Promise<ProjectRecord | undefined>): void {
  protocol.handle("ygg-file", async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const projectId = parts[0];
    if (url.hostname !== "f" || !projectId || parts.length < 2) return new Response("Not found", { status: 404 });
    const project = await getProject(projectId);
    if (!project) return new Response("Not found", { status: 404 });

    const root = resolve(project.path);
    const target = resolve(root, ...parts.slice(1));
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) return new Response("Forbidden", { status: 403 });

    // net.fetch on a file:// URL streams from disk and honours Range requests
    // (audio seeking), so large models/audio never go through base64.
    try {
      return await net.fetch(pathToFileURL(target).toString(), {
        headers: request.headers,
        bypassCustomProtocolHandlers: true,
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
