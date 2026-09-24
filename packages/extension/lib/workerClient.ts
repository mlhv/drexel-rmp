import type { LookupResult } from "@drexel-rmp/shared";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Wrap a fetch so every request aborts after `ms` (covers slow headers and slow bodies). */
export function withTimeout(fetchFn: FetchFn, ms: number): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchFn(input, { ...init, signal: AbortSignal.timeout(ms) })) as typeof fetch;
}

/** Runtime check of the Worker's wire format — a bad body must never reach the cache or the badge. */
function isLookupResult(value: unknown): value is LookupResult {
  const v = value as { status?: unknown; rating?: Record<string, unknown> } | null;
  if (v?.status === "not_found") return true;
  if (v?.status !== "found" || typeof v.rating !== "object" || v.rating === null) return false;
  const r = v.rating;
  return (
    typeof r.name === "string" &&
    typeof r.rating === "number" &&
    typeof r.difficulty === "number" &&
    typeof r.numRatings === "number" &&
    typeof r.legacyId === "number" &&
    typeof r.rmpUrl === "string" &&
    (r.wouldTakeAgain === null || typeof r.wouldTakeAgain === "number")
  );
}

/** Returns a fetcher for `GET <baseUrl>/prof?name=`. Throws on timeout, non-2xx, or a malformed body. */
export function createWorkerFetcher(baseUrl: string, timeoutMs: number, fetchFn: FetchFn = fetch) {
  const timedFetch = withTimeout(fetchFn, timeoutMs);
  return async (name: string): Promise<LookupResult> => {
    const res = await timedFetch(`${baseUrl}/prof?name=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`worker HTTP ${res.status}`);
    const json: unknown = await res.json();
    if (!isLookupResult(json)) throw new Error("unexpected worker response");
    return json;
  };
}
