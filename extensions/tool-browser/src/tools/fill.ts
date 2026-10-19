import { defineTool } from "@yggdrasil/tools-sdk";
import { getPage } from "../browser-pool.js";

export const fillTool = defineTool({
  name: "browser_fill",
  description: "Fill a text input or textarea on the current page.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector of the input element" },
      value: { type: "string", description: "Text to type into the input" },
    },
    required: ["selector", "value"],
  },
  async execute(ctx, args) {
    const page = await getPage(ctx.sessionKey);
    await page.fill(String(args.selector), String(args.value));
    return { filled: true, selector: args.selector };
  },
});
