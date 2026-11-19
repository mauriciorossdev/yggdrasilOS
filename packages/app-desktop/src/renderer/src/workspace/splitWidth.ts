const KEY = "yggdrasil.workspace.width";
export const MIN_WORKSPACE = 360;
export const MIN_CHAT = 320;

/** Opening width of the workspace: about half the window, within what both sides need. */
export function defaultWorkspaceWidth(containerWidth: number): number {
  return clampWorkspaceWidth(Math.round(containerWidth * 0.5), containerWidth);
}

/** The chat always keeps a usable column, and the workspace never gets narrower than its tab strip needs. */
export function clampWorkspaceWidth(width: number, containerWidth: number): number {
  const max = Math.max(MIN_WORKSPACE, containerWidth - MIN_CHAT);
  return Math.round(Math.min(max, Math.max(MIN_WORKSPACE, width)));
}

export function readSavedWidth(): number | null {
  try {
    const raw = Number(localStorage.getItem(KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function saveWidth(width: number): void {
  try {
    localStorage.setItem(KEY, String(Math.round(width)));
  } catch {
    // storage unavailable: the width just won't persist
  }
}
