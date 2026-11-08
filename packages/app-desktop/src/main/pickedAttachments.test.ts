import { describe, expect, it } from "vitest";
import { classifyPickedPaths } from "./pickedAttachments.js";

const kinds: Record<string, "file" | "directory"> = {
  "/p/proj/README.md": "file",
  "/p/proj/src": "directory",
  "/p/proj/src/a.ts": "file",
};
const kindOf = async (path: string) => kinds[path] ?? null;

describe("classifyPickedPaths", () => {
  it("turns paths inside the project into project-relative attachments with their type", async () => {
    const res = await classifyPickedPaths("/p/proj", ["/p/proj/README.md", "/p/proj/src", "/p/proj/src/a.ts"], kindOf);
    expect(res.attachments).toEqual([
      { relativePath: "README.md", type: "file" },
      { relativePath: "src", type: "directory" },
      { relativePath: "src/a.ts", type: "file" },
    ]);
    expect(res.rejected).toEqual([]);
  });

  it("reports what is outside the project instead of dropping it silently", async () => {
    const res = await classifyPickedPaths("/p/proj", ["/p/other/x.txt", "/p/proj/README.md", "/p/proj/../secret"], kindOf);
    expect(res.attachments.map((a) => a.relativePath)).toEqual(["README.md"]);
    expect(res.rejected).toEqual(["/p/other/x.txt", "/p/proj/../secret"]);
  });

  it("rejects the project folder itself and skips paths that vanished", async () => {
    const res = await classifyPickedPaths("/p/proj", ["/p/proj", "/p/proj/gone.txt"], kindOf);
    expect(res.rejected).toEqual(["/p/proj"]);
    expect(res.attachments).toEqual([]);
  });

  it("doesn't mistake a sibling with the same prefix for part of the project", async () => {
    const res = await classifyPickedPaths("/p/proj", ["/p/proj-old/a.txt"], kindOf);
    expect(res.rejected).toEqual(["/p/proj-old/a.txt"]);
  });
});
