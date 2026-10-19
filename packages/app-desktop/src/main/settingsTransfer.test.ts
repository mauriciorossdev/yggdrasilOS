import { describe, expect, it } from "vitest";
import {
  buildExportMarkdown,
  deepMerge,
  dropEmptySecrets,
  parseImportMarkdown,
  stripSecrets,
} from "./settingsTransfer.js";

const desktop = { tts: { enabled: true, voiceId: "x", apiToken: "r8_secret" }, ide: { command: "code" } };
const gateway = {
  language: "es",
  providers: { openai: { baseUrl: "https://api.openai.com", apiKey: "sk-123" } },
  mcpServers: { s: { transport: "stdio", command: "npx", env: { TOKEN: "abc" } } },
  gateway: { port: 1 },
  connectors: { google: {} },
};

describe("settingsTransfer", () => {
  it("strips credentials but keeps URLs", () => {
    const s = stripSecrets(gateway);
    expect(s.providers.openai).toEqual({ baseUrl: "https://api.openai.com", apiKey: "" });
    expect(s.mcpServers.s).toEqual({ transport: "stdio", command: "npx" });
  });

  it("round-trips with secrets", () => {
    const md = buildExportMarkdown({ desktop, gateway, includeSecrets: true, exportedAt: new Date(0) });
    const p = parseImportMarkdown(md);
    expect(p.desktop).toEqual(desktop);
    expect(p.gateway).toMatchObject({ language: "es", providers: gateway.providers });
    expect(p.gateway).not.toHaveProperty("gateway");
    expect(p.gateway).not.toHaveProperty("connectors");
  });

  it("export without secrets never wipes existing keys on import", () => {
    const md = buildExportMarkdown({ desktop, gateway, includeSecrets: false, exportedAt: new Date(0) });
    const p = parseImportMarkdown(md);
    expect(p.desktop).toEqual({ tts: { enabled: true, voiceId: "x" }, ide: { command: "code" } });
    const merged = deepMerge({ tts: { apiToken: "keep-me", enabled: false } }, p.desktop!);
    expect(merged).toMatchObject({ tts: { apiToken: "keep-me", enabled: true } });
  });

  it("warns on bad input", () => {
    expect(parseImportMarkdown("hello").warnings.length).toBe(1);
    const bad = parseImportMarkdown("## Desktop settings\n\n```json\n{oops\n```\n");
    expect(bad.desktop).toBeNull();
    expect(bad.warnings[0]).toContain("invalid JSON");
  });

  it("dropEmptySecrets keeps non-secret blanks", () => {
    expect(dropEmptySecrets({ apiKey: "", voiceId: "" })).toEqual({ voiceId: "" });
  });
});
