import type { GatewayClient } from "../client/gateway-client.js";
import type { TuiAction, TuiState } from "../state/store.js";

export type SkillCommand = { name: string; description: string; prompt: string };

/** Everything a slash command may touch; App builds one per render so commands stay plain functions. */
export type CommandContext = {
  client: Pick<GatewayClient, "call" | "disconnect">;
  state: TuiState;
  dispatch: (action: TuiAction) => void;
  gatewayUrl: string;
  senderIdPrefix?: string;
  /** Where /export writes. */
  cwd: string;
  skills: SkillCommand[];
  exit: () => void;
  renameSession: (sessionKey: string, title: string) => Promise<void>;
  showAgentForm: (show: boolean) => void;
  openModelPicker: (providerId: string) => void;
  /** Sends text to the agent as if the user typed it (used by skill commands). */
  sendMessage: (text: string) => void;
};

export type SlashCommand = {
  name: string;
  aliases?: string[];
  description: string;
  /** Shown in /help instead of the bare name, e.g. "rename <title>". */
  usage?: string;
  /** Left out of the command palette (commands that only make sense with an argument). */
  noPalette?: boolean;
  /** `args` is everything after the command name, trimmed. */
  run: (ctx: CommandContext, args: string) => void | Promise<void>;
};
