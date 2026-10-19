import { definePlugin } from "@yggdrasil/sdk";
import { defineTool } from "@yggdrasil/tools-sdk";

const getWeatherTool = defineTool({
  name: "get_weather",
  description: "Returns mock weather for a city (demo plugin).",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
    },
    required: ["city"],
  },
  async execute(_ctx, args) {
    const city = String(args.city ?? "unknown");
    return { city, tempC: 22, condition: "sunny" };
  },
});

const plugin = definePlugin({
  id: "tool-weather",
  name: "Weather Tool",
  version: "0.4.0",
  register(api) {
    api.registerTool(getWeatherTool);
    api.logger.info("registered tool", { name: getWeatherTool.name });
  },
});

export default plugin;
