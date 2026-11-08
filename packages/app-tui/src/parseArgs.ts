const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

export type CliOptions = {
  gatewayUrl: string;
  apiKey?: string;
  agentId?: string;
  continueSession: boolean;
  alternateScreen: boolean;
};

/** Accepts both `--flag value` and `--flag=value`. */
export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    gatewayUrl: DEFAULT_GATEWAY_URL,
    continueSession: false,
    // --no-alt-screen (or YGGDRASIL_TUI_ALT_SCREEN=0) keeps the UI in the normal terminal buffer.
    alternateScreen: process.env.YGGDRASIL_TUI_ALT_SCREEN !== "0",
  };
  const valueFlags: Record<string, "gatewayUrl" | "apiKey" | "agentId"> = {
    "--connect": "gatewayUrl",
    "--api-key": "apiKey",
    "--agent": "agentId",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--continue" || arg === "-c") {
      options.continueSession = true;
      continue;
    }
    if (arg === "--no-alt-screen") {
      options.alternateScreen = false;
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const key = valueFlags[name];
    if (!key) continue;
    const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
    if (value) options[key] = value;
  }

  return options;
}
