import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";

type LaunchOptions = {
  gatewayUrl: string;
  senderIdPrefix?: string;
  continueSession?: boolean;
  agentId?: string;
  sessionKey?: string;
  readOnly?: boolean;
};

export async function launchTui(options: LaunchOptions): Promise<(() => void) | undefined> {
  console.clear();
  const { waitUntilExit, unmount } = render(
    React.createElement(App, {
      gatewayUrl: options.gatewayUrl,
      senderIdPrefix: options.senderIdPrefix,
      continueSession: options.continueSession,
      initialAgentId: options.agentId,
      initialSessionKey: options.sessionKey,
      readOnly: options.readOnly,
    }),
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
  return unmount;
}
