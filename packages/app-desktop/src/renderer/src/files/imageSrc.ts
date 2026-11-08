const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** An image address that isn't a path in the project: a web URL, a data URI, an app protocol. */
export function isExternalSrc(src: string): boolean {
  return EXTERNAL.test(src);
}

/**
 * The project-relative path an image `src` points at, resolved against the note that contains it
 * (`../shared/a.png` from `notes/x/n.md` is `notes/shared/a.png`; a leading `/` means the project
 * root). Null for an external address, an empty one, or a path that climbs out of the project.
 */
export function resolveProjectPath(notePath: string, src: string): string | null {
  const clean = src.split("#")[0]!.split("?")[0]!.trim();
  if (!clean || isExternalSrc(clean)) return null;
  let decoded = clean;
  try {
    decoded = decodeURI(clean);
  } catch {
    // Not valid percent-encoding: take it literally.
  }
  const dir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  const segments = decoded.startsWith("/") ? decoded.split("/") : [...dir.split("/"), ...decoded.split("/")];
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null;
      stack.pop();
    } else stack.push(segment);
  }
  return stack.length > 0 ? stack.join("/") : null;
}

/** What to put in the `<img>` so it loads: the app's file protocol for project files, the address as is for the rest. */
export function displaySrc(notePath: string, src: string, fileUrl: (projectPath: string) => string): string {
  const projectPath = resolveProjectPath(notePath, src);
  return projectPath ? fileUrl(projectPath) : src;
}
