import { definePlugin } from "@yggdrasil/sdk";
import { defineTool } from "@yggdrasil/tools-sdk";

const localDatetimeTool = defineTool({
  name: "local_datetime",
  description: "Returns local date/time from the plugin extension (reference tool plugin).",
  parameters: {
    type: "object",
    properties: {
      timezone: { type: "string", description: "IANA timezone, e.g. America/Mexico_City" },
    },
  },
  async execute(_ctx, args) {
    const tz = typeof args.timezone === "string" ? args.timezone : undefined;
    const now = new Date();
    if (tz) {
      return {
        iso: now.toISOString(),
        local: now.toLocaleString("en-US", { timeZone: tz }),
        timezone: tz,
      };
    }
    return { iso: now.toISOString(), local: now.toString() };
  },
});

const plugin = definePlugin({
  id: "tool-datetime",
  name: "Datetime Tool",
  version: "0.1.0",
  register(api) {
    api.registerTool(localDatetimeTool);
  },
});

export default plugin;
