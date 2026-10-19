#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

function parseArgs(): { gatewayUrl: string } {
  const args = process.argv.slice(2);
  let gatewayUrl = DEFAULT_GATEWAY_URL;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--connect" && args[i + 1]) {
      gatewayUrl = args[i + 1]!;
      i++;
    }
    if (args[i]?.startsWith("--connect=")) {
      gatewayUrl = args[i]!.slice("--connect=".length);
    }
  }

  return { gatewayUrl };
}

const { gatewayUrl } = parseArgs();

console.clear();

const { waitUntilExit } = render(
  React.createElement(App, { gatewayUrl }),
  { exitOnCtrlC: false },
);

waitUntilExit().then(() => {
  process.exit(0);
});
