export type SearchConfig = {
  braveApiKey?: string;
  searxngUrl?: string;
};

export function resolveConfig(ctx: { config: unknown }): SearchConfig {
  const pluginCfg = (ctx.config as Record<string, unknown> | null)?.pluginConfig as
    | Record<string, unknown>
    | undefined;
  const cfg = (pluginCfg?.["tool-search"] ?? {}) as SearchConfig;
  return {
    braveApiKey: cfg.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY,
    searxngUrl: cfg.searxngUrl ?? process.env.SEARXNG_URL,
  };
}
