import type { ContextBlock, ContextProviderContext } from "@yggdrasil/context-sdk";
import { listContextProviders } from "@yggdrasil/kernel";
import type { ChatMessage } from "@yggdrasil/sdk";
import { getContextCache } from "./cache.js";

const PROVIDER_TIMEOUT_MS = 2000;
const DEFAULT_TTL_MS = 300_000;

async function runWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function resolveContext(
  ctx: ContextProviderContext,
  providerIds: string[],
  tokenBudget?: number,
): Promise<ChatMessage[]> {
  const allProviders = listContextProviders();
  const selected = providerIds.length > 0
    ? allProviders.filter((p) => providerIds.includes(p.id))
    : allProviders;

  if (selected.length === 0) return [];

  const cache = getContextCache();
  const blocks: ContextBlock[] = [];

  const promises = selected.map(async (provider) => {
    const cacheKey = `${provider.id}:${ctx.agentId}:${ctx.sessionKey}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const globalCfg = ctx.globalConfig as { pluginConfig?: Record<string, unknown> } | undefined;
    const providerCtx: typeof ctx = {
      ...ctx,
      config: globalCfg?.pluginConfig?.[provider.id] ?? ctx.config,
    };

    try {
      if (provider.supports) {
        const supported = await provider.supports(providerCtx);
        if (!supported) return [];
      }

      const result = await runWithTimeout(provider.assemble(providerCtx), PROVIDER_TIMEOUT_MS);
      if (!result) {
        console.warn(`[context] provider ${provider.id} timed out`);
        return [];
      }

      const ttl = result[0]?.ttlMs ?? DEFAULT_TTL_MS;
      const cacheable = result[0]?.cacheable !== false;
      if (cacheable) {
        cache.set(cacheKey, result, ttl);
      }
      return result;
    } catch (err) {
      console.warn(`[context] provider ${provider.id} failed:`, err instanceof Error ? err.message : err);
      return [];
    }
  });

  const results = await Promise.all(promises);
  for (const result of results) {
    blocks.push(...result);
  }

  blocks.sort((a, b) => a.priority - b.priority);

  let totalTokens = 0;
  const trimmed: ContextBlock[] = [];
  for (const block of blocks) {
    const est = block.tokens ?? Math.ceil(block.content.length / 4);
    if (tokenBudget && totalTokens + est > tokenBudget) break;
    totalTokens += est;
    trimmed.push(block);
  }

  return trimmed.map((block) => ({
    role: block.role,
    content: block.content,
  }));
}
