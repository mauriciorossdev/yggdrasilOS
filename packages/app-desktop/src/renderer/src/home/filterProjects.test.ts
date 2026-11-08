import { describe, expect, it } from "vitest";
import { filterProjects } from "./filterProjects.js";

const projects = [
  { name: "Yggdrasil", path: "/Users/me/code/world-tree" },
  { name: "Blog", path: "/Users/me/sites/blog" },
];

describe("filterProjects", () => {
  it("returns everything for an empty or blank query", () => {
    expect(filterProjects(projects, "")).toEqual(projects);
    expect(filterProjects(projects, "   ")).toEqual(projects);
  });
  it("matches name case-insensitively", () => {
    expect(filterProjects(projects, "YGG")).toEqual([projects[0]]);
  });
  it("matches path", () => {
    expect(filterProjects(projects, "sites")).toEqual([projects[1]]);
  });
  it("requires every term", () => {
    expect(filterProjects(projects, "blog sites")).toEqual([projects[1]]);
    expect(filterProjects(projects, "blog world")).toEqual([]);
  });
});
