import { defineTool } from "@yggdrasil/tools-sdk";

export const datetimeTool = defineTool({
  name: "datetime",
  description: "Returns the current date and time in ISO 8601 format.",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute() {
    return { iso: new Date().toISOString() };
  },
});

export const echoTool = defineTool({
  name: "echo",
  description: "Echoes back the provided arguments (for testing).",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Message to echo back" },
    },
    required: ["message"],
  },
  async execute(_ctx, args) {
    return { echoed: args };
  },
});

export const builtinTools = [datetimeTool, echoTool];
