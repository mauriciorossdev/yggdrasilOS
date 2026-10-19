import { definePlugin, type AgentHarness } from "@yggdrasil/sdk";

const harness: AgentHarness = {
  id: "{{PLUGIN_ID}}",
  label: "{{PLUGIN_LABEL}}",
  supports() {
    return { supported: true, priority: 10 };
  },
  async runAttempt(params) {
    return {
      text: `[{{PLUGIN_ID}}] ${params.message}`,
      classification: "ok",
    };
  },
};

const plugin = definePlugin({
  id: "{{PLUGIN_ID}}",
  name: "{{PLUGIN_LABEL}}",
  version: "0.1.0",
  register(api) {
    api.registerHarness(harness);
  },
});

export default plugin;
