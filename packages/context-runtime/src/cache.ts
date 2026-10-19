import type { ContextBlock } from "@yggdrasil/context-sdk";

type CacheEntry = {
  blocks: ContextBlock[];
  expiresAt: number;
};

export class ContextCache {
  private store = new Map<string, CacheEntry>();

  get(key: string): ContextBlock[] | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.blocks;
  }

  set(key: string, blocks: ContextBlock[], ttlMs: number): void {
    this.store.set(key, { blocks, expiresAt: Date.now() + ttlMs });
  }

  invalidate(providerId: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(`${providerId}:`)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

let globalCache: ContextCache | null = null;

export function getContextCache(): ContextCache {
  if (!globalCache) globalCache = new ContextCache();
  return globalCache;
}

export function resetContextCacheForTest(): void {
  globalCache = null;
}
