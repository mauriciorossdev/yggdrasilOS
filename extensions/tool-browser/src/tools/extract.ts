import { defineTool } from "@yggdrasil/tools-sdk";
import { getPage } from "../browser-pool.js";

export const extractTool = defineTool({
  name: "browser_extract",
  description:
    "Extract text content or an HTML attribute from all elements matching a CSS selector.",
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector" },
      attribute: {
        type: "string",
        description: "HTML attribute to extract (e.g. 'href', 'src'). Omit to get innerText.",
      },
      limit: {
        type: "number",
        description: "Maximum number of elements to return (default 10).",
      },
    },
    required: ["selector"],
  },
  async execute(ctx, args) {
    const page = await getPage(ctx.sessionKey);
    const attr = typeof args.attribute === "string" ? args.attribute : null;
    const limit = typeof args.limit === "number" ? args.limit : 10;
    const results = await page.evaluate(
      ({ sel, a, lim }: { sel: string; a: string | null; lim: number }) => {
        const els = Array.from(document.querySelectorAll(sel)).slice(0, lim);
        return els.map((el) =>
          a ? (el as HTMLElement).getAttribute(a) : (el as HTMLElement).innerText,
        );
      },
      { sel: String(args.selector), a: attr, lim: limit },
    );
    return { results };
  },
});
