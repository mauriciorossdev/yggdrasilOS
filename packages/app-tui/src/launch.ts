import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import type { ApprovalMode } from "./client/types.js";

type LaunchOptions = {
  gatewayUrl: string;
  senderIdPrefix?: string;
  continueSession?: boolean;
  agentId?: string;
  sessionKey?: string;
  readOnly?: boolean;
  /** Approval mode to start in (the user can still cycle it with Shift+Tab). */
  initialMode?: ApprovalMode;
  /** Model id sent as the override on every chat.send, instead of the agent's own. */
  model?: string;
  apiKey?: string;
  /** Render on the terminal's alternate screen (like vim): the UI owns the whole window and the shell's scrollback is restored on exit. Default true. */
  alternateScreen?: boolean;
};

export async function launchTui(options: LaunchOptions): Promise<(() => void) | undefined> {
  const { waitUntilExit, unmount } = render(
    React.createElement(App, {
      gatewayUrl: options.gatewayUrl,
      senderIdPrefix: options.senderIdPrefix,
      continueSession: options.continueSession,
      initialAgentId: options.agentId,
      initialSessionKey: options.sessionKey,
      readOnly: options.readOnly,
      initialMode: options.initialMode,
      modelOverride: options.model,
      apiKey: options.apiKey,
    }),
    { exitOnCtrlC: false, alternateScreen: options.alternateScreen ?? process.env.YGGDRASIL_TUI_ALT_SCREEN !== "0" },
  );

  await waitUntilExit();
  return unmount;
}
