import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { app } from "electron";

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastOpenedAt: number;
  color: string | null;
};

export function registryPath(): string {
  return join(app.getPath("userData"), "projects.json");
}

async function readRegistry(): Promise<ProjectRecord[]> {
  try {
    const raw = await readFile(registryPath(), "utf8");
    return JSON.parse(raw) as ProjectRecord[];
  } catch {
    return [];
  }
}

async function writeRegistry(projects: ProjectRecord[]): Promise<void> {
  await mkdir(dirname(registryPath()), { recursive: true });
  await writeFile(registryPath(), JSON.stringify(projects, null, 2), "utf8");
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const projects = await readRegistry();
  return [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  const projects = await readRegistry();
  return projects.find((p) => p.id === id);
}

export async function renameProject(id: string, name: string): Promise<ProjectRecord | undefined> {
  const projects = await readRegistry();
  const project = projects.find((p) => p.id === id);
  if (!project) return undefined;
  project.name = name;
  await writeRegistry(projects);
  return project;
}

export async function setProjectColor(id: string, color: string | null): Promise<ProjectRecord | undefined> {
  const projects = await readRegistry();
  const project = projects.find((p) => p.id === id);
  if (!project) return undefined;
  project.color = color;
  await writeRegistry(projects);
  return project;
}

/** Drops a project from the registry only — never touches its folder on disk. */
export async function removeProject(id: string): Promise<boolean> {
  const projects = await readRegistry();
  const next = projects.filter((p) => p.id !== id);
  if (next.length === projects.length) return false;
  await writeRegistry(next);
  return true;
}

/** Bumps lastOpenedAt for a project opened from the project list, so "most recently opened" ordering is real. */
export async function touchProject(id: string): Promise<void> {
  const projects = await readRegistry();
  const project = projects.find((p) => p.id === id);
  if (!project) return;
  project.lastOpenedAt = Date.now();
  await writeRegistry(projects);
}

/** Registers a project folder if new, or bumps lastOpenedAt if already known (keyed by path). */
export async function upsertProject(input: { path: string; name?: string }): Promise<ProjectRecord> {
  const projects = await readRegistry();
  const existing = projects.find((p) => p.path === input.path);
  const now = Date.now();

  if (existing) {
    existing.lastOpenedAt = now;
    await writeRegistry(projects);
    return existing;
  }

  const record: ProjectRecord = {
    id: randomUUID(),
    name: input.name ?? basename(input.path),
    path: input.path,
    createdAt: now,
    lastOpenedAt: now,
    color: null,
  };
  projects.push(record);
  await writeRegistry(projects);
  return record;
}
