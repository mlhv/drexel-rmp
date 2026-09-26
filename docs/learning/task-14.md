# Learning notes — Task 14: A manifest that depends on the build mode

## What we built

```
wxt.config.ts ──(mode)──▶ buildManifest(mode, key)      lib/manifest.ts (pure)
                               │
          "production" ────────┼──▶ storage + 3 exact hosts          → store zip
          "development" ───────┴──▶ same + localhost:8787 + key       → unpacked dev
```

- `lib/manifest.ts`: `PROD_WORKER_URL`, `EXTENSION_PUBLIC_KEY` (empty for now), and the pure `buildManifest()`.
- `lib/config.ts`: `WORKER_URL` now comes from `resolveWorkerUrl(import.meta.env.WXT_WORKER_URL)`.
- `lib/manifest.test.ts` (4 tests) and `lib/config.test.ts` (3 tests). Extension suite: 84 tests.
- `.gitignore` ignores `.env*.local`. The testing checklist's kill-switch drill uses the env var instead of editing code.

## Concept 1: Why the manifest logic is its own pure function

WXT lets `manifest` be a function of `{ mode, browser, command }`. We could have put the `if (mode === "development")` directly in `wxt.config.ts`, but then the only way to test it is to run a build and parse `manifest.json`. Pulling it into `buildManifest(mode, publicKey)` makes it a plain function: string in, object out, tested in milliseconds.

The production test uses `toEqual` on the **whole object**, not `toContain`. That is deliberate: it's a *guard test*. If someone later adds `"tabs"` or a new host, the test fails, and they have to edit the test on purpose. Store reviewers compare your permission justifications against the manifest, so permission changes should never happen by accident.

## Concept 2: Code that runs in two worlds

`wxt.config.ts` is loaded by **Node** at build time, before Vite exists. `lib/config.ts` runs **inside the extension**, compiled by Vite, where `import.meta.env.WXT_*` is replaced with values from `.env` files. That's why `manifest.ts` must not touch `import.meta.env` or `wxt/browser`: it's imported by both. So the dependency points one way: `config.ts` imports `PROD_WORKER_URL` from `manifest.ts`, never the other way around.

## Concept 3: Blank is not the same as set

Two tests are about empty strings:
- `buildManifest("development", "")` must *omit* `key`. Chrome refuses to load an extension whose `"key": ""`, and the key is empty until you do the store bootstrap.
- `resolveWorkerUrl("  ")` must fall back to production. `override ?? PROD` would keep `"  "` (only `null`/`undefined` trigger `??`), so the code uses `override?.trim() || PROD`: `||` treats `""` as missing.

This `??` vs `||` choice comes up constantly in TypeScript: `??` means "missing", `||` means "missing or falsy".

## Concept 4: Why `key` is dev-only

An extension's ID is derived from a public key. The store generates that key on first upload, and it **rejects** zips that include `key` themselves. But an unpacked dev copy without `key` gets a random, path-based ID. Putting the store's public key in the *dev* manifest makes the dev copy's ID identical to the store's, which the Worker's CORS allowlist (Task 19) relies on.
