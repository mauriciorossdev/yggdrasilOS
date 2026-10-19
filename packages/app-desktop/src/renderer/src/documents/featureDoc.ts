// Feature docs: the shared brief an orchestrating agent writes to
// notes/features/<slug>.md and hands to worker panes by path (the layout is
// taught in main/mcpConfig.ts's documents guide, "Feature docs"). Pure helpers
// so the template and the progress parsing stay in one tested place.

export const FEATURES_DIR = "notes/features";

export const FEATURE_STATUSES = ["working", "checking", "ready", "needs-decision"] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export type FeatureTask = { done: boolean; text: string };

export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Project-relative path for a new feature doc, or null when the title has nothing usable for a filename. */
export function featureDocPath(title: string): string | null {
  const slug = slugify(title);
  return slug ? `${FEATURES_DIR}/${slug}.md` : null;
}

export function buildFeatureDoc(title: string): string {
  return `# ${title.trim()}
Status: working

## Specs
S1 — (quote the user's own words here, verbatim) — Acceptance: (how we know it's done)

## Tasks
- [ ] T1 (S1) (what to do) — owner: (pane title)

## Log
L1 — (the user's original request, verbatim)
`;
}

function tasksSection(md: string): string[] {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Tasks\s*$/i.test(l));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Checkbox items inside `## Tasks` only — checkboxes elsewhere (Specs, Log) don't count. */
export function parseTasks(md: string): { done: number; total: number; items: FeatureTask[] } {
  const items: FeatureTask[] = [];
  for (const line of tasksSection(md)) {
    // `\[x\]` too: an editor that doesn't understand task lists escapes the
    // brackets when it re-saves the file, and the progress must survive that.
    const m = /^\s*[-*]\s+\\?\[([ xX])\\?\]\s+(.*\S)\s*$/.exec(line);
    if (m) items.push({ done: m[1] !== " ", text: m[2]! });
  }
  return { done: items.filter((i) => i.done).length, total: items.length, items };
}

export function parseStatus(md: string): FeatureStatus | null {
  const m = /^Status:\s*(\S+)\s*$/im.exec(md);
  const value = m?.[1]?.toLowerCase();
  return FEATURE_STATUSES.find((s) => s === value) ?? null;
}
