import { definePlugin } from "@yggdrasil/sdk";
import { invokeCliTool } from "./invoke-cli-tool.js";

// Reused directly by extensions/service-workflows's agent.ask node executor
// — same headless CLI delegation this tool already does for chat, just
// invoked without the tool-call/approval/session-persistence wrapper around
// it (a workflow's agent.ask is a one-shot call, not an ongoing chat).
export { runHeadless, extractReply, truncate, type HeadlessRunResult } from "./headless-run.js";
export type { DelegateCli } from "./session-store.js";

const tools = [invokeCliTool];

const plugin = definePlugin({
  id: "tool-cli-delegate",
  name: "CLI Delegate Tools",
  version: "0.1.0",
  register(api) {
    for (const tool of tools) {
      api.registerTool(tool);
      api.logger.info("registered cli-delegate tool", { name: tool.name });
    }
  },
});

export default plugin;
