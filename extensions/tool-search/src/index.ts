import { definePlugin } from "@yggdrasil/sdk";
import { defineTool } from "@yggdrasil/tools-sdk";
import { resolveConfig } from "./config.js";
import { braveSearch } from "./providers/brave.js";
import { searxngSearch } from "./providers/searxng.js";

const webSearchTool = defineTool({
  name: "web_search",
  description:
    "Search the web and return a list of relevant results (title, URL, description). " +
    "Requires BRAVE_SEARCH_API_KEY env var or a local SearXNG instance (SEARXNG_URL).",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      count: { type: "number", description: "Number of results to return (default: 5, max: 10)" },
    },
    required: ["query"],
  },
  async execute(ctx, args) {
    const query = String(args.query);
    const count = Math.min(typeof args.count === "number" ? args.count : 5, 10);
    const cfg = resolveConfig(ctx);

    if (cfg.braveApiKey) {
      const results = await braveSearch(query, count, cfg.braveApiKey);
      return { provider: "brave", query, results };
    }

    if (cfg.searxngUrl) {
      const results = await searxngSearch(query, count, cfg.searxngUrl);
      return { provider: "searxng", query, results };
    }

    throw new Error(
      "No search provider configured. Set BRAVE_SEARCH_API_KEY or SEARXNG_URL, " +
      "or configure pluginConfig[\"tool-search\"].braveApiKey / .searxngUrl in yggdrasil.config.json.",
    );
  },
});

const plugin = definePlugin({
  id: "tool-search",
  name: "Web Search",
  version: "0.1.0",
  register(api) {
    api.registerTool(webSearchTool);
  },
});

export default plugin;
