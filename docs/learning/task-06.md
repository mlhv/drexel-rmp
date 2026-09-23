# Learning notes — Task 6: Shipping the Worker to production

## What we did

The Worker from Task 5 is now live at a public URL:

```
https://drexel-rmp-worker.mlhv.workers.dev/prof?name=jeffrey%20popyack
  1st call → 200 found, 0.57s   (KV miss → RMP round-trip → KV write)
  2nd call → 200 found, 0.10s   (KV hit — RMP never contacted)
  /prof    → 400 name required
```

Steps: `wrangler login` → `wrangler kv namespace create RMP_CACHE` → paste the returned id into `wrangler.toml` → `wrangler deploy` → verify with `curl`.

## Concept 1: Infrastructure is declared, then bound by id

Until now `wrangler.toml` held a dummy id (`000…0`) and everything still worked, because the test runtime (and `wrangler dev`) make a throwaway in-memory KV for whatever binding name you declare. Production is different: the *binding name* (`RMP_CACHE`) is what your code sees, but the *id* is what points at a real storage bucket on Cloudflare's side.

```toml
[[kv_namespaces]]
binding = "RMP_CACHE"                          # name in code: c.env.RMP_CACHE
id = "2e1d7c3f7219480fadaa9a4d2cb31e92"        # which real namespace
```

That split is a general pattern (**logical name vs physical resource**): code refers to a stable logical name; configuration decides what it resolves to. It's why you could point the same code at a staging namespace later by changing one line, without touching `src/`.

Is committing the id safe? Yes. A KV namespace id is an identifier, not a credential. Without your Cloudflare login (which `wrangler login` stores outside the repo, in your home directory) nobody can read or write it. Contrast with an API token, which must never be committed.

## Concept 2: What `wrangler deploy` actually does

1. **Bundles** `src/index.ts` plus its imports (Hono, `@drexel-rmp/shared`) into one JS file with esbuild — the dry run reported 71 KiB (17.7 KiB gzipped). Workers have no `node_modules` at runtime; everything ships in the bundle. That's why a small dependency footprint matters on the edge.
2. **Uploads** it with the binding metadata, and Cloudflare distributes it to its edge locations within seconds.
3. **Routes** it at `<worker-name>.<your-subdomain>.workers.dev`.

`--dry-run` does step 1 and prints the bindings without uploading — a cheap pre-flight check that the config and bundle are valid before touching production.

## Concept 3: The TLS "failure" right after deploy

The first `curl` failed with `sslv3 alert handshake failure` (curl exit code 35). The code wasn't broken: the connection was reaching Cloudflare, but the **HTTPS certificate** for the brand-new `mlhv.workers.dev` subdomain hadn't been issued yet. Cloudflare provisions certificates automatically, but it takes a few seconds to minutes the first time a subdomain is used.

Debugging habit worth keeping: read *which layer* failed before touching code.

| Symptom | Layer | Likely cause |
|---|---|---|
| DNS can't resolve | naming | typo, subdomain not registered |
| TLS handshake failure | encryption | cert not provisioned yet / wrong host |
| HTTP 5xx | your code or its dependencies | bug, RMP down |
| HTTP 4xx | your code's validation | bad request |

`curl -v` showed DNS resolved and TCP connected, then TLS failed. That pinned it to the certificate layer, so the right move was to wait and retry, not edit the Worker. After ~20 seconds of polling it answered.

## Concept 4: Verifying in production, not just in tests

Tests proved the logic with a fake KV and mocked RMP. The two `curl` calls prove the things tests *can't*:

- the real RMP endpoint still accepts our query and auth header,
- the real KV namespace is bound and writable,
- caching actually happens: the second call is ~5× faster because it skips the RMP round-trip. The latency difference *is* the evidence of a cache hit.

A **smoke test** like this (a handful of real requests after each deploy) is the cheapest insurance in operations. It's also a good interview story: "how do you know your deploy worked?" → "I hit it and compared a cold and a warm request."

## Where this leaves the architecture

The server half of the 3-layer lookup now exists for real:

```
extension local cache (24h)  →  Worker + KV (7d / 1d)  →  RMP directly
       Tasks 9–10                    ✅ live now            fallback
```

Task 10 will paste `https://drexel-rmp-worker.mlhv.workers.dev` into the extension's `WORKER_URL`. Next is Task 7: scaffolding the Chrome extension itself with WXT.
