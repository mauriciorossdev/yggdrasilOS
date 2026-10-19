import { defineTool } from "@yggdrasil/tools-sdk";
import { getPage } from "../browser-pool.js";

export const screenshotTool = defineTool({
  name: "browser_screenshot",
  description: "Take a screenshot of the current browser page. Returns base64-encoded PNG.",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(ctx, _args) {
    const page = await getPage(ctx.sessionKey);
    const buf = await page.screenshot({ type: "png", fullPage: false });
    // __ygg_image__ sentinel — without it tool-loop.ts falls through to
    // JSON.stringify(output), dumping the entire base64 PNG as raw text into
    // the chat's tool-result bubble instead of showing/describing the image.
    // Same contract as extensions/tool-image and tool-desktop's screenshot.
    return { __ygg_image__: true, base64: buf.toString("base64"), mimeType: "image/png" };
  },
});
