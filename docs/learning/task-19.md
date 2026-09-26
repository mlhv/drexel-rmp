# Learning notes — Task 19: Restricting the Worker's CORS to the extension

## What we built

- `wrangler.toml` `[vars] ALLOWED_ORIGIN = ""`: filled in with `chrome-extension://<id>` during the runbook bootstrap.
- `cors({ origin: fn })` in `packages/worker/src/index.ts` echoes the origin only if it equals `ALLOWED_ORIGIN`.
- 5 new tests in `test/prof.test.ts`. Worker suite: 10 tests.

## Concept 1: What CORS actually protects (and what it doesn't)

CORS is enforced by **browsers**, on behalf of **web pages**. When `https://evil.example` runs `fetch("https://your-worker/prof?...")`, the browser sends the request, but only lets the page *read* the response if the Worker replies with `Access-Control-Allow-Origin` naming that page's origin. So:

- It does **not** stop `curl`, Python scripts, or other servers. They ignore CORS entirely.
- It does **not** affect your own extension. Its background service worker has `host_permissions` for the Worker, and that exempts it from CORS.
- It **does** stop random websites from quietly using your Worker (and your free-tier quota) from their visitors' browsers.

That's why the code comment calls it "hygiene, not access control". Real abuse protection would be rate limiting, which is out of scope for now.

## Concept 2: The `"" === ""` trap

Hono calls `origin(originHeader, c)` with `""` when a request has no `Origin` header. Before bootstrap, `ALLOWED_ORIGIN` is also `""`. A naive `origin === allowed` would be *true*, and the Worker would send an empty `Access-Control-Allow-Origin` header. The `allowed && ...` guard makes "not configured" mean "allow nothing". A dedicated test pins this, because it's exactly the state the Worker is in until you finish the runbook.

## Concept 3: Preflight requests

For some cross-origin requests, browsers first send an `OPTIONS` "preflight" asking "may I?". Hono's cors middleware answers it with `204 No Content` plus the CORS headers, without ever reaching your `/prof` handler. The preflight test checks both answers: yes for the extension, silence for others.

## Concept 4: Config through environment bindings

`ALLOWED_ORIGIN` is a Wrangler **var**. At runtime it appears on `c.env` next to the `RMP_CACHE` KV binding. Tests override it per request with `app.fetch(req, { ...env, ALLOWED_ORIGIN: EXT })`, so each case controls its own configuration without editing files: the same dependency-injection idea used throughout this project, applied to config.

A small typing lesson from this task: `[{}, { Origin: EXT }]` is inferred as `({ Origin?: undefined } | { Origin: string })[]`, which doesn't fit `Record<string, string>`. TypeScript infers the *union of the element shapes*, so we annotated the array's type explicitly.
