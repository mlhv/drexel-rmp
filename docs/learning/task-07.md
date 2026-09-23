# Learning notes — Task 7: Scaffolding the Chrome extension with WXT

## What we built

A third workspace package, `packages/extension`, that builds into a loadable Chrome extension:

```
packages/extension/
  package.json          scripts: dev / build / zip / test, postinstall: wxt prepare
  wxt.config.ts         manifest settings (name, permissions, host_permissions)
  tsconfig.json         extends WXT's generated config
  vitest.config.ts      tests run in happy-dom with WXT's plugin
  entrypoints/
    background.ts       the service worker (a stub for now; Task 10 fills it)
```

`pnpm -F @drexel-rmp/extension build` produces `.output/chrome-mv3/`, a folder Chrome can load directly (chrome://extensions → Developer mode → Load unpacked). Right now it contains just two files: `manifest.json` and `background.js`, 1 kB total.

## Concept 1: What a browser extension is, structurally

An MV3 extension is a folder with a `manifest.json` that tells Chrome which scripts to run where. The pieces we'll build:

| Piece | Runs where | Lifetime | Our use |
|---|---|---|---|
| **Background service worker** | its own hidden context | started on demand, killed when idle | lookups: cache → Worker → RMP (Task 10) |
| **Content scripts** | inside the Drexel page | as long as the tab | find instructor names, inject badges (Tasks 12–13) |

Why split? Content scripts live *on someone else's page*: they share the DOM with Drexel's code and are subject to that page's rules. The background worker is the extension's own privileged context. It gets the host permissions, so it's where network calls to RMP and our Worker belong. Content scripts ask it for data via messages. This is the same client/server split you just built, only inside the browser.

"Service worker" in MV3 means the background has no persistent state in memory: Chrome may kill it after ~30s idle. That's why Task 9 stores the cache in `chrome.storage.local`, not in a variable, the same "stateless compute, state in storage" idea as the Cloudflare Worker + KV.

## Concept 2: Permissions are the security model

```ts
permissions: ["storage"],
host_permissions: [
  "https://*.drexel.edu/*",            // read Drexel pages (content scripts)
  "https://www.ratemyprofessors.com/*", // call RMP directly (fallback)
  "https://*.workers.dev/*",           // call our Worker
  "http://localhost:8787/*",           // call `wrangler dev` while developing
],
```

Every entry is shown to the user at install time and reviewed by the Chrome Web Store. **Least privilege**: ask only for what you use. We *don't* request `tabs`, `<all_urls>`, or `scripting`, because we don't need them. A narrow permission list is also what makes a store review fast.

The host permissions are also what let the background worker `fetch` RMP and our Worker without CORS errors: extensions with host permission for a domain are exempt from that domain's CORS checks. (This is why the Worker's open CORS isn't load-bearing for the extension.)

## Concept 3: WXT — a build tool that writes the manifest for you

Handwriting `manifest.json` means keeping file paths, script registrations and permissions in sync by hand. **WXT** (a Vite-based framework) flips it: you write TypeScript files in `entrypoints/`, and WXT *generates* the manifest from them plus `wxt.config.ts`. Notice the built manifest has a `"background": {"service_worker": "background.js"}` entry we never wrote. WXT found `entrypoints/background.ts` and registered it.

Two pieces of WXT magic worth understanding rather than trusting blindly:

- **Auto-imports.** `background.ts` calls `defineBackground(...)` with no import statement. WXT injects the import at build time and declares the global type so TypeScript knows about it.
- **`wxt prepare` / `.wxt/`.** The `postinstall` script runs `wxt prepare`, which generates `.wxt/tsconfig.json` (path aliases, auto-import type declarations). Our `tsconfig.json` just extends it. `.wxt/` is gitignored because it's derived output, regenerated on every install, like `node_modules`.

`vitest.config.ts` uses `WxtVitest()` so tests get the same auto-imports plus a fake `browser` API, and `happy-dom` provides a fake DOM for testing content-script code without a real browser.

## Concept 4: pnpm 11 build-script approvals (supply-chain defense)

`pnpm install` failed with `ERR_PNPM_IGNORED_BUILDS`. Background: npm packages can declare install scripts that run arbitrary code on your machine the moment you install them. That's a favorite attack in supply-chain compromises (a hijacked package runs a credential stealer in `postinstall`). pnpm 11 therefore **blocks all install scripts by default** and makes you approve them per package in `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true      # downloads its native binary — needed by Vite/WXT/wrangler
  workerd: true      # Cloudflare's runtime, used by the worker tests
  sharp: false       # image library pulled in by miniflare; we never use it
  spawn-sync: false  # legacy helper in WXT's Firefox runner; not needed to build
```

pnpm had written `set this to true or false` placeholders, and those invalid values made *every* pnpm command fail (even `pnpm test`), which is why the decision couldn't be skipped. The rule of thumb: approve a script when you know what it does and the package needs it to work; deny it otherwise and confirm nothing breaks. We verified both halves: all 24 existing tests still pass and the extension builds.

## Concept 5: Verify the artifact, not just the exit code

"Build succeeded" only proves the build ran. The plan's check is to read `.output/chrome-mv3/manifest.json` and compare it with the requirements (`manifest_version: 3`, `storage`, four host permissions). The file Chrome loads is what matters, not the config that produced it. Same habit as `curl`-ing the Worker after deploy.

One expected wart: `pnpm -F @drexel-rmp/extension test` currently fails with "No test files found". Vitest treats an empty suite as an error on purpose, so a mistyped glob can't silently pass. Task 8 adds the first tests.
