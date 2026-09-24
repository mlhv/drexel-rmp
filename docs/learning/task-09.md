# Learning notes — Task 9: The extension's local cache

## What we built

`packages/extension/lib/cache.ts`, the first (fastest) layer of the 3-layer lookup:

```
getCached("Jeffrey Popyack")
  → { result, fresh: true }    stored < 24h ago: use it, no network at all
  → { result, fresh: false }   stored ≥ 24h ago: refresh, but keep as a last resort
  → null                       nothing usable (miss, unreadable, or corrupt)

setCached("Jeffrey Popyack", result)   // stores { result, storedAt: Date.now() }
```

Keys are `rmp:<lowercased name>` in `chrome.storage.local`. 6 tests; 32 in the extension overall.

## Concept 1: Why the extension caches when the Worker already does

The Worker's KV cache saves *RMP* from repeat traffic. It doesn't save the *student* from a network round-trip: every badge would still wait ~100ms+ for the Worker, and there'd be dozens per page. A local cache makes a repeat visit to the same course page instant and works even offline.

Two layers with different TTLs is a classic **cache hierarchy** (like CPU L1/L2 caches, or browser cache → CDN → origin):

| Layer | Where | Fresh for | Shared by |
|---|---|---|---|
| `chrome.storage.local` | your laptop | 24h | just you |
| Workers KV | Cloudflare edge | 7d / 1d | every user |
| RMP | origin | — | — |

The inner layer is shorter-lived so that when KV gets a newer rating, you see it within a day.

## Concept 2: Stale-while-unavailable

Most caches throw expired entries away. This one keeps them and just labels them `fresh: false`. The orchestrator (Task 10) treats a stale entry as "try the network first, but if both the Worker and RMP are down, a day-old rating beats no rating." Ratings change slowly, so old data is still useful. This is a deliberate **availability over freshness** choice, and the reason `getCached` returns a `fresh` flag instead of deciding for the caller: the cache reports facts, the orchestrator makes the policy.

## Concept 3: Why `chrome.storage` and not a variable or `localStorage`

- **A variable** in the background service worker dies whenever Chrome kills the idle worker (~30s). Covered in Task 7: state must live in storage.
- **`localStorage`** isn't available in service workers at all, and in a content script it would belong to *drexel.edu's* origin, so Drexel's own scripts could read or clear it.
- **`chrome.storage.local`** belongs to the extension, survives restarts, works from every extension context, and is async (doesn't block the page).

`browser` from `wxt/browser` is WXT's cross-browser wrapper around `chrome.*`. In tests, WxtVitest swaps it for `fakeBrowser`, an in-memory implementation, so tests exercise the real storage API shape without a browser.

## Concept 4: The Task 5 lesson again, caught earlier this time

Before writing code I read how Task 10 will *call* this module:

```ts
const cached = await deps.getCached(name);   // outside any try
...
try {
  const result = await fetcher(name);
  await deps.setCached(name, result);        // inside the per-source try
  return result;
} catch { /* try the next source */ }
```

With the plan's cache, a storage read error would fail the whole lookup (no badge). A storage write error after the Worker *succeeded* would be caught as if the Worker failed, throw away the good result, and hit RMP directly for no reason. Same failure-domain mixup the reviewer caught in the Worker's KV code.

Rather than add try/catch in every caller, the fix went into the cache itself: **the cache module promises never to throw**. That's documented in its doc comments and enforced by tests that make `fakeBrowser.storage.local.get`/`set` reject. General idea: when a component is an optimization, make its interface *total* (every input gives an answer, never an exception), and callers stay simple.

## Concept 5: Don't trust what's in storage

Storage outlives code. If a future version changes the entry shape, or the data gets corrupted, `stored[key] as StoredEntry` would happily pass garbage along (`as` is a promise to the compiler, not a check). `isStoredEntry` is a **type guard** that actually checks at runtime (`storedAt` is a number, `result.status` is a string) before TypeScript narrows the type. Anything else is a miss, and the next successful lookup overwrites it. Same idea as `rmpParse.ts` validating RMP's responses: data crossing a boundary gets checked, whether it comes from a network or from your own disk.

## Concept 6: Proving the new tests test something

I first dropped in the plan's original implementation and ran the suite: the 3 plan tests passed and **exactly the 3 new tests failed**. Only then did I write the hardened version. A test you've never seen fail might be passing for the wrong reason (wrong mock, assertion that can't fail). Seeing red first is the cheapest proof it guards what you think it does.
