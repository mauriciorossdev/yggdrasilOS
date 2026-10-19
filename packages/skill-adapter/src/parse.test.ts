import { describe, it, expect } from "vitest";
import { parseSkillMd, parseCommandToml } from "./parse.js";

describe("parseSkillMd", () => {
  it("falls back to raw content when there is no frontmatter", () => {
    const result = parseSkillMd("just plain instructions", "fallback-name");
    expect(result).toEqual({ name: "fallback-name", description: "", instructions: "just plain instructions" });
  });

  it("parses name and inline description from frontmatter", () => {
    const raw = `---\nname: my-skill\ndescription: "does a thing"\n---\nBody instructions here.`;
    const result = parseSkillMd(raw, "fallback");
    expect(result.name).toBe("my-skill");
    expect(result.description).toBe("does a thing");
    expect(result.instructions).toBe("Body instructions here.");
  });

  it("uses the fallback name when frontmatter has no name field", () => {
    const raw = `---\ndescription: hi\n---\nbody`;
    const result = parseSkillMd(raw, "fallback-name");
    expect(result.name).toBe("fallback-name");
  });

  // KNOWN BUG: the inline regex in extractYamlString matches the bare ">" on
  // "description: >" before the block-scalar branch ever runs, so folded
  // descriptions never get assembled into "line one line two" as intended.
  // This test documents the current (likely unintended) behavior.
  it("currently returns a bare '>' for a folded description instead of the folded text", () => {
    const raw = `---\nname: x\ndescription: >\n  line one\n  line two\n---\nbody`;
    const result = parseSkillMd(raw, "fallback");
    expect(result.description).toBe(">");
  });

  it("trims the instructions body", () => {
    const raw = `---\nname: x\n---\n\n  padded body  \n\n`;
    const result = parseSkillMd(raw, "fallback");
    expect(result.instructions).toBe("padded body");
  });
});

describe("parseCommandToml", () => {
  it("extracts name, description, and prompt", () => {
    const raw = `name = "greet"\ndescription = "says hi"\nprompt = "Say hello to the user"`;
    const result = parseCommandToml(raw, "fallback");
    expect(result).toEqual({ name: "greet", description: "says hi", prompt: "Say hello to the user" });
  });

  it("uses the fallback name when name is missing", () => {
    const raw = `description = "d"\nprompt = "p"`;
    const result = parseCommandToml(raw, "fallback-cmd");
    expect(result.name).toBe("fallback-cmd");
  });

  it("returns empty strings for missing description/prompt", () => {
    const raw = `name = "solo"`;
    const result = parseCommandToml(raw, "fallback");
    expect(result.description).toBe("");
    expect(result.prompt).toBe("");
  });
});
