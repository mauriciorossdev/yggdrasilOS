#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { parseArgs } from "./parseArgs.js";

const { gatewayUrl, apiKey, agentId, continueSession, alternateScreen } = parseArgs(process.argv.slice(2));

const { waitUntilExit } = render(
  React.createElement(App, { gatewayUrl, apiKey, initialAgentId: agentId, continueSession }),
  { exitOnCtrlC: false, alternateScreen },
);

waitUntilExit().then(() => {
  process.exit(0);
});
