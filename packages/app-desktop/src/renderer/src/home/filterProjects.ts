/** Case-insensitive match on project name or path; every whitespace-separated term must hit one of them. */
export function filterProjects<T extends { name: string; path: string }>(projects: T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return projects;
  return projects.filter((p) => {
    const haystack = `${p.name}\n${p.path}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}
