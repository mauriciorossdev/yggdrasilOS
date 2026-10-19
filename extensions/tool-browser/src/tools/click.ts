import { defineTool } from "@yggdrasil/tools-sdk";
import { getPage } from "../browser-pool.js";

export const clickTool = defineTool({
  name: "browser_click",
  description: "Click an element on the current page by CSS selector.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector of the element to click" },
    },
    required: ["selector"],
  },
  async execute(ctx, args) {
    const page = await getPage(ctx.sessionKey);
    await page.click(String(args.selector), { timeout: 5000 });
    return { clicked: true, selector: args.selector };
  },
});
