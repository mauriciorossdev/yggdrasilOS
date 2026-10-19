export function basenameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export function moveTargetPath(sourceRelativePath: string, targetDirRelativePath: string): string {
  const name = basenameOf(sourceRelativePath);
  return targetDirRelativePath ? `${targetDirRelativePath}/${name}` : name;
}

/** True if `path` is `dir` itself or lives somewhere inside it — used to reject dropping a folder into itself or one of its own descendants. */
export function isSameOrDescendant(dir: string, path: string): boolean {
  return dir === path || dir.startsWith(`${path}/`);
}
