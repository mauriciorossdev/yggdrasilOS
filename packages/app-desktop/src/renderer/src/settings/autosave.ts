// Settings save themselves. This splits the form into parts that are written
// independently, each comparable as a string against what was last saved.
// Agents and the default agent are not here: that list saves itself.
import { buildProvidersPatch } from "@yggdrasil/ui-kit";
import type { ConfigShape, IdeSettings, SttSettings, SyncSettings, WhisperSettings } from "../types.js";

export type SettingsForm = {
  config: ConfigShape | null;
  loadedProviders: ConfigShape["providers"];
  apiKeyEdits: Record<string, string>;
  mcpSecretEdits: Record<string, string>;
  whisper: WhisperSettings | null;
  stt: SttSettings | null;
  ide: IdeSettings | null;
  sync: SyncSettings | null;
};

export type SettingsPart = "general" | "providers" | "mcp" | "whisper" | "stt" | "ide" | "sync";
export type SettingsParts = Record<SettingsPart, string>;

export const ALL_PARTS: SettingsPart[] = ["general", "providers", "mcp", "whisper", "stt", "ide", "sync"];
/**
 * Written only on leaving the section or closing: half-typed, an MCP server would
 * be launched with an incomplete command and a provider would get a cut-off key.
 */
export const DEFERRED_PARTS: SettingsPart[] = ["providers", "mcp"];
export const TYPING_PARTS = ALL_PARTS.filter((p) => !DEFERRED_PARTS.includes(p));

const typed = (edits: Record<string, string>) => Object.entries(edits).filter(([, value]) => value !== "");

export const mcpPart = (servers: unknown, secrets: Record<string, string>) => JSON.stringify([servers ?? {}, typed(secrets)]);

/**
 * Servers still being filled in (no command, or no URL). While there is one, the
 * MCP part isn't written: it would be stored and launched as it is.
 */
export function incompleteMcpServers(servers: ConfigShape["mcpServers"]): string[] {
  return Object.entries(servers ?? {})
    .filter(([, s]) => !(s.transport === "stdio" ? s.command : s.url)?.trim())
    .map(([id]) => id);
}

/** The providers part with nothing left to write (it is a diff against what was loaded). */
export const NO_PROVIDER_EDITS = JSON.stringify([{}, []]);

export function settingsParts({ config, loadedProviders, apiKeyEdits, mcpSecretEdits, whisper, stt, ide, sync }: SettingsForm): SettingsParts {
  return {
    general: JSON.stringify([config?.language ?? "", config?.harness ?? {}, config?.channels ?? {}]),
    providers: JSON.stringify([config ? buildProvidersPatch(config, loadedProviders, apiKeyEdits) : {}, typed(apiKeyEdits)]),
    mcp: mcpPart(config?.mcpServers, mcpSecretEdits),
    whisper: JSON.stringify(whisper),
    stt: JSON.stringify(stt),
    ide: JSON.stringify(ide),
    sync: JSON.stringify(sync),
  };
}

export function changedParts(saved: SettingsParts, current: SettingsParts, among: SettingsPart[] = ALL_PARTS): SettingsPart[] {
  return among.filter((p) => saved[p] !== current[p]);
}
