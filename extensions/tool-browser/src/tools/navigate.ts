import { defineTool } from "@yggdrasil/tools-sdk";
import { getPage } from "../browser-pool.js";

export const navigateTool = defineTool({
  name: "browser_navigate",
  description:
    "Navigate to a URL and return the page title and visible text content (first 8000 chars).",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Full URL including protocol, e.g. https://example.com" },
    },
    required: ["url"],
  },
  async execute(ctx, args) {
    const page = await getPage(ctx.sessionKey);
    await page.goto(String(args.url), { waitUntil: "domcontentloaded", timeout: 15000 });
    const title = await page.title();
    const text = await page.evaluate(
      () => (document.body?.innerText ?? "").slice(0, 8000),
    );
    return { title, url: page.url(), text };
  },
});
