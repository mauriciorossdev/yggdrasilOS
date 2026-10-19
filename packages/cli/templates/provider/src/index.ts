import { definePlugin, type ProviderPlugin } from "@yggdrasil/sdk";

const provider: ProviderPlugin = {
  id: "{{PLUGIN_ID}}",
  label: "{{PLUGIN_LABEL}}",
  listModels() {
    return [{ id: "stub", label: "Stub Model", provider: "{{PLUGIN_ID}}" }];
  },
  async chatComplete(_ctx, params) {
    return {
      text: `stub response to: ${params.messages.at(-1)?.content ?? ""}`,
      model: params.model,
    };
  },
};

const plugin = definePlugin({
  id: "{{PLUGIN_ID}}",
  name: "{{PLUGIN_LABEL}}",
  version: "0.1.0",
  register(api) {
    api.registerProvider(provider);
  },
});

export default plugin;
