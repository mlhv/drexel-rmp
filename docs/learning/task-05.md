# Learning notes — Task 5: The Cloudflare Worker (your first real backend)

## What we built

`packages/worker` — an HTTP service with one endpoint:

```
GET /prof?name=jeffrey%20popyack
  → KV cache hit?  return it            (fast path, no RMP traffic)
  → miss:          ask RMP via the shared client
                   store result in KV (7d found / 1d not_found)
                   return it
  → RMP down:      502 {"error":"rmp_unavailable"}
```

It passed a live smoke test: `wrangler dev` locally, real request to RMP, real KV write, correct JSON back.

## Concept 1: What a Cloudflare Worker actually is

A traditional backend is a server process (Express on a VM/container) that you keep alive, scale, and pay for while idle. A **Worker** is just a function deployed to Cloudflare's ~300 edge locations, spun up **on demand** inside a V8 *isolate* — the same sandboxing primitive Chrome uses for tabs — not a container. Consequences worth being able to articulate:

- **Cold starts in ~milliseconds** (isolates are tiny vs containers) and requests run *near the user*.
- **No Node.js**: the runtime is Web-standard APIs — `fetch`, `Request`, `Response`, the same objects the browser has. Notice `src/index.ts` imports zero HTTP server machinery; it just exports an object with a `fetch(request, env)` method. Our extension's service worker speaks the same API family — one mental model everywhere.
- **Stateless by design**: an isolate can be created/destroyed between any two requests, so state lives in attached services — that's what **KV** is.

## Concept 2: Workers KV and cache policy

KV is a globally-replicated key→value store, **eventually consistent** (a write in Philadelphia may take seconds to be visible in Tokyo — fine for a cache, wrong for a bank balance). Our policy decisions, and the reasoning behind each:

- **Key design**: `prof:<lowercased name>`. The `prof:` prefix namespaces keys so a future feature (say `course:`) can share the store without collisions. Lowercasing = one cache entry per professor regardless of caller's casing — this is *cache-key normalization*, and forgetting it is a classic cache-hit-rate bug.
- **TTLs encode how fast truth changes**: found → 7 days (ratings drift slowly); not_found → 1 day (a *negative* result is more likely to become stale — the professor might get added to RMP tomorrow). Caching negatives at all is the important idea (**negative caching**): without it, every page load re-queries RMP for every TA who'll never be found — the most common lookup is often the miss.
- **`expirationTtl`** means KV deletes entries for us — no cleanup job. Always prefer storage-native expiry over hand-rolled janitors.

## Concept 3: Hono, and typed environment bindings

**Hono** is Express for the edge: `app.get("/prof", handler)`, middleware (`app.use("*", cors())`), `c.json(body, status)`. Two details worth study:

- The Worker doesn't "connect" to KV with a URL/credentials — Cloudflare **injects** it as a binding: `wrangler.toml` declares `binding = "RMP_CACHE"`, and it appears as `c.env.RMP_CACHE`, a live object. We describe that to TypeScript with `type Env = { Bindings: { RMP_CACHE: KVNamespace } }` — infra config and type system kept in sync by hand (and verified by tests).
- CORS is open (`cors()`) for now — ratings are public data, and we can't lock to the extension's origin until the extension has a stable ID (deferred deliberately, recorded in the plan).

## Concept 4: Failure domains — the review lesson

The first version had one big `try { lookup + cache-write } catch { 502 }`. The reviewer asked the right question: *what else can throw inside that block?* Answer: the KV `put`. So a KV hiccup after a *successful* RMP lookup would have (a) mislabeled itself as "rmp_unavailable" and (b) thrown away a perfectly good result. And the KV *read* wasn't guarded at all → unhandled 500.

The fix gives **each failure domain exactly one policy**:

| Failure | Policy |
|---|---|
| KV read fails | degrade to cache miss, proceed |
| RMP fails | 502 — the one thing we truly can't recover |
| KV write fails | serve the result anyway; caching is an optimization, not a requirement |

General principle: **a `try` block's width is a design decision.** Wrapping more than one fallible operation in a single catch means you can no longer tell your failures apart — scope each catch to the single operation whose failure it knows how to handle. Interviewers love this topic ("what happens if the cache is down?"), and now you have a concrete story: the cache is an optimization; the system must serve *through* a dead cache, and we have a test that literally injects a KV that throws on every call and asserts the user still gets their rating.

## Concept 5: Testing inside the real runtime

`@cloudflare/vitest-pool-workers` runs the tests *inside workerd* (Cloudflare's actual runtime) with an in-memory KV — not a Node simulation. Plus `fetchMock.disableNetConnect()`: any HTTP call our code makes that isn't explicitly intercepted **throws**. That turns "the cache-hit path must not call RMP" from a hope into a mechanically enforced property — an unregistered call would 502 the request and fail the assertion. Deny-by-default network in tests is a habit worth stealing for every project.

Also note the test trick `app.fetch(request, fakeEnv)` — because a Worker is *just a function of (request, env)*, tests can hand it any env they like, including a KV stub whose every method throws. Functions-of-inputs are testable; globals aren't. Same DI lesson as Task 4, now at the service level.
