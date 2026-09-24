# Learning notes — Task 10: The lookup brain and the background service worker

## What we built

```
content script ──sendMessage({type:"LOOKUP_PROFESSOR", name})──▶ background.ts
                                                                    │
                                                    createLookupService.lookup(name)
                                                                    │
      1. fresh local cache (<24h)?  ── yes ──▶ return it, no network
      2. Worker  (3s timeout)       ── ok  ──▶ cache it, return it
      3. RMP direct (5s timeout)    ── ok  ──▶ cache it, return it
      4. stale local cache?         ── yes ──▶ return it (better than nothing)
      5. null                                  → content script shows no badge
```

Files: `lib/lookup.ts` (the chain), `lib/workerClient.ts` (calling the Worker safely), `lib/config.ts` (URL + timeouts, now pointing at your live Worker), `entrypoints/background.ts` (wiring + message listener). 17 new tests, 49 in the extension; the built extension is 5.65 kB.

## Concept 1: Fallback chains and why the order is what it is

Each layer is tried only if the one before it can't answer, ordered **cheapest and most reliable first**:

- Local cache: 0 network, instant.
- Worker: one fast hop, and shared KV means someone else's lookup probably warmed it.
- RMP direct: slower, and the layer most likely to get rate-limited, so it's the backup, not the default.
- Stale cache: explicitly a last resort (Task 9's "availability over freshness").

Note the loop in `doLookup`: `for (const fetcher of [deps.fetchFromWorker, deps.fetchDirect])`. The fallback policy is a *list*, so adding or reordering a source is a one-line change, not a new nested `try`.

## Concept 2: Dependency injection makes the chain testable

`createLookupService(deps)` doesn't import the cache, `fetch`, or RMP. It receives them. Tests pass `vi.fn()` fakes and can say "the Worker throws, RMP returns X" in one line, then assert *which* layers were called (`expect(deps.fetchDirect).not.toHaveBeenCalled()`). `background.ts` is the only place real implementations get plugged in. That file is where you *compose* the app; everything else is testable logic. (Same pattern as `lookupProfessorViaRmp(name, fetchFn)` in Task 4 and `app.fetch(req, env)` in Task 5.)

## Concept 3: Deduping in-flight requests

A course page may list the same professor in 10 sections. Without deduping, that's 10 identical network requests fired at once, because none has finished to populate the cache. The fix is a `Map<name, Promise>`:

```ts
let pending = inflight.get(key);
if (!pending) {
  pending = doLookup(name).finally(() => inflight.delete(key));
  inflight.set(key, pending);
}
return pending;   // all 10 callers await the same promise
```

A promise can be awaited any number of times, so sharing it is free. `.finally` removes the entry once it settles, so the *next* page load does a fresh lookup (which will then hit the cache). This is called **request coalescing** (or "single-flight"), and CDNs do the same thing to protect origins.

## Concept 4: Why timeouts matter doubly with coalescing

The plan only put a timeout on the Worker. But if the direct RMP request hangs, its promise never settles, so `.finally` never runs and the entry is **never removed from `inflight`**. Every future lookup of that professor, until Chrome kills the service worker, would join a promise that will never finish. One hung request becomes a permanently missing badge.

So `lib/workerClient.ts` has a small `withTimeout(fetch, ms)` wrapper using `AbortSignal.timeout(ms)`, applied to both paths (3s Worker, 5s RMP). Rule: **every network call needs a deadline**, and it matters most when other callers share the result.

`AbortSignal.timeout` aborts the *whole* request, including reading the body, not just waiting for headers. The test proves the abort actually happens: a fake fetch that only rejects when its signal fires, with a 20ms timeout.

## Concept 5: Validate at the boundary, again

The plan's Worker call only checked `status`. A `{"status":"found"}` with no `rating` would pass, get *cached for 24h*, and crash the badge later, far from the cause. `isLookupResult` checks every field the UI uses. Pattern recap across the project: `rmpParse.ts` checks RMP's responses, `isStoredEntry` checks disk (Task 9), `isLookupResult` checks the Worker. **Anything that crosses a trust boundary gets a runtime check**, because TypeScript types vanish at runtime and `as LookupResult` checks nothing.

## Concept 6: Extension messaging

Content scripts (on the Drexel page) can't make the privileged requests, so they message the background:

```ts
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ...
  service.lookup(msg.name).then(sendResponse).catch(() => sendResponse(null));
  return true; // keep the channel open
});
```

The odd part is `return true`: Chrome's listener API predates promises. By default, the reply channel closes when the listener returns. Returning `true` means "I'll call `sendResponse` later, asynchronously." Forget it and the content script receives `undefined` immediately. The listener also checks `msg.type` and `typeof msg.name`, because messages are just untyped data (`unknown`) at runtime.

## Concept 7: A test that could never have passed

The plan's dedupe test did:

```ts
const [p1, p2] = [svc.lookup("A B"), svc.lookup("a b")];
resolveWorker(FOUND);   // TypeError: resolveWorker is not a function
```

`lookup` is async: it first `await`s `getCached`, and only *after* that microtask does it call the fake Worker, which is what assigns `resolveWorker`. At the moment of the call, it's still unset. The fix is `await vi.waitFor(() => expect(deps.fetchFromWorker).toHaveBeenCalled())` before resolving. I confirmed the diagnosis by running the plan's exact version: it fails with that TypeError. Lesson: in async code, "I called it" doesn't mean "it has run yet". Every `await` is a point where other code gets a turn.
