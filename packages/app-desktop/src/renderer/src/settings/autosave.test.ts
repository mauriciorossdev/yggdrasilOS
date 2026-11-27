import { describe, expect, it } from "vitest";
import type { ConfigShape } from "../types.js";
import { changedParts, DEFERRED_PARTS, incompleteMcpServers, NO_PROVIDER_EDITS, settingsParts, TYPING_PARTS, type SettingsForm } from "./autosave.js";

const config = { agents: [], providers: { openai: { baseUrl: "https://a" } }, mcpServers: {} } as unknown as ConfigShape;
const form: SettingsForm = {
  config,
  loadedProviders: config.providers,
  apiKeyEdits: {},
  mcpSecretEdits: {},
  whisper: null,
  stt: null,
  ide: null,
  sync: null,
};
const changed = (patch: Partial<SettingsForm>) => changedParts(settingsParts(form), settingsParts({ ...form, ...patch }));

describe("settings autosave parts", () => {
  it("reports only the part that changed", () => {
    expect(changed({ config: { ...config, language: "español" } })).toEqual(["general"]);
    expect(changed({ apiKeyEdits: { openai: "k" } })).toEqual(["providers"]);
    expect(changed({ mcpSecretEdits: { x: "s" } })).toEqual(["mcp"]);
    expect(changed({ sync: { serverUrl: "https://s" } as SettingsForm["sync"] })).toEqual(["sync"]);
  });

  it("ignores emptied fields and what saves on its own", () => {
    expect(changed({ config: { ...config, language: "" } })).toEqual([]);
    expect(changed({ apiKeyEdits: { openai: "" } })).toEqual([]);
    expect(changed({ config: { ...config, agents: [{ id: "new" }], defaultAgent: "new" } as unknown as ConfigShape })).toEqual([]);
  });

  it("never writes providers or MCP while typing", () => {
    expect(DEFERRED_PARTS).toEqual(["providers", "mcp"]);
    expect(TYPING_PARTS).not.toContain("mcp");
    expect(TYPING_PARTS).not.toContain("providers");
  });

  it("holds back MCP servers that have no command or URL yet", () => {
    const servers = {
      ok: { transport: "stdio", command: "npx" },
      web: { transport: "http", url: "https://x" },
      empty: { transport: "stdio", command: "  " },
      nourl: { transport: "http" },
    } as unknown as ConfigShape["mcpServers"];
    expect(incompleteMcpServers(servers)).toEqual(["empty", "nourl"]);
  });

  it("has a fixed value for providers with nothing to write", () => {
    expect(settingsParts(form).providers).toBe(NO_PROVIDER_EDITS);
  });
});
