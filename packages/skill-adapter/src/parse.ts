export type SkillMd = {
  name: string;
  description: string;
  instructions: string;
};

export type SkillCommand = {
  name: string;
  description: string;
  prompt: string;
};

/** Parse a SKILL.md file: YAML frontmatter (---...---) + markdown body */
export function parseSkillMd(raw: string, fallbackName: string): SkillMd {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { name: fallbackName, description: "", instructions: raw.trim() };
  }

  const frontmatter = fmMatch[1] ?? "";
  const body = fmMatch[2] ?? "";

  const name = extractYamlString(frontmatter, "name") ?? fallbackName;
  // description may be a multi-line YAML block scalar (> or |)
  const description = extractYamlString(frontmatter, "description") ?? "";

  return { name, description, instructions: body.trim() };
}

/** Parse a commands/*.toml file: simple key=value, no sections */
export function parseCommandToml(raw: string, fallbackName: string): SkillCommand {
  const description = extractTomlString(raw, "description") ?? "";
  const prompt = extractTomlString(raw, "prompt") ?? "";
  const name = extractTomlString(raw, "name") ?? fallbackName;
  return { name, description, prompt };
}

function extractYamlString(yaml: string, key: string): string | undefined {
  // Matches: key: "value", key: value, key: >\n  folded
  const inline = new RegExp(`^${key}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, "m");
  const inlineMatch = yaml.match(inline);
  if (inlineMatch?.[1]) return inlineMatch[1].trim();

  // Block scalar (> or |): grab indented lines that follow
  const blockRe = new RegExp(`^${key}:\\s*[>|]\\r?\\n((\\s+.+\\r?\\n?)*)`, "m");
  const blockMatch = yaml.match(blockRe);
  if (blockMatch?.[1]) {
    return blockMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
  }

  return undefined;
}

function extractTomlString(toml: string, key: string): string | undefined {
  // key = "value" or key = 'value'
  const re = new RegExp(`^${key}\\s*=\\s*["']([\\s\\S]*?)["']\\s*$`, "m");
  const match = toml.match(re);
  return match?.[1]?.trim();
}
