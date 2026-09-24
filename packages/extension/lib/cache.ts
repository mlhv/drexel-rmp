import type { LookupResult } from "@drexel-rmp/shared";
import { browser } from "wxt/browser";

const FRESH_MS = 24 * 60 * 60 * 1000;

interface StoredEntry {
  result: LookupResult;
  storedAt: number;
}

const cacheKey = (name: string) => `rmp:${name.toLowerCase()}`;

function isStoredEntry(value: unknown): value is StoredEntry {
  const v = value as Partial<StoredEntry> | null | undefined;
  return typeof v?.storedAt === "number" && typeof v.result?.status === "string";
}

/**
 * Never throws: the cache is an optimization, so a read failure or a
 * malformed entry degrades to a miss rather than failing the lookup.
 */
export async function getCached(
  name: string,
): Promise<{ result: LookupResult; fresh: boolean } | null> {
  const key = cacheKey(name);
  let entry: unknown;
  try {
    entry = (await browser.storage.local.get(key))[key];
  } catch {
    return null;
  }
  if (!isStoredEntry(entry)) return null;
  return { result: entry.result, fresh: Date.now() - entry.storedAt < FRESH_MS };
}

/** Never throws: a failed write must not discard a result we already have. */
export async function setCached(name: string, result: LookupResult): Promise<void> {
  const entry: StoredEntry = { result, storedAt: Date.now() };
  try {
    await browser.storage.local.set({ [cacheKey(name)]: entry });
  } catch {
    // e.g. storage quota exceeded — serve the result uncached
  }
}
