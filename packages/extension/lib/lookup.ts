import type { LookupResult } from "@drexel-rmp/shared";

export interface LookupDeps {
  /** Never throws (see cache.ts). */
  getCached(name: string): Promise<{ result: LookupResult; fresh: boolean } | null>;
  /** Never throws (see cache.ts). */
  setCached(name: string, result: LookupResult): Promise<void>;
  /** Throws on failure/timeout. */
  fetchFromWorker(name: string): Promise<LookupResult>;
  /** Throws on failure/timeout. */
  fetchDirect(name: string): Promise<LookupResult>;
}

/**
 * 3-layer lookup: fresh local cache -> worker -> RMP direct -> stale cache -> null.
 * Concurrent lookups for the same name share one in-flight promise.
 */
export function createLookupService(deps: LookupDeps) {
  const inflight = new Map<string, Promise<LookupResult | null>>();

  async function doLookup(name: string): Promise<LookupResult | null> {
    const cached = await deps.getCached(name);
    if (cached?.fresh) return cached.result;

    for (const fetcher of [deps.fetchFromWorker, deps.fetchDirect]) {
      try {
        const result = await fetcher(name);
        await deps.setCached(name, result);
        return result;
      } catch {
        // fall through to next layer
      }
    }
    return cached?.result ?? null; // stale beats nothing; null = truly unavailable
  }

  return {
    lookup(name: string): Promise<LookupResult | null> {
      const key = name.toLowerCase();
      let pending = inflight.get(key);
      if (!pending) {
        pending = doLookup(name).finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      return pending;
    },
  };
}
