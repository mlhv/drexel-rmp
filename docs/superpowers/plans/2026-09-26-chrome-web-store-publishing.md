# Chrome Web Store Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the finished extension store-ready as "DU ProfessorView": exact production permissions, original icon, CI-built release zips, a GitHub Pages privacy policy, versioned listing copy + submission runbook, and a Worker CORS allowlist.

**Architecture:** A pure `buildManifest(mode, publicKey)` function in the extension package drives `wxt.config.ts`, so dev-only entries (localhost, `key`) can never reach a production zip and a unit test pins the production manifest. GitHub Actions runs tests/build on every push, builds the store zip on `v*` tags into a GitHub Release, and deploys a static `site/` to Pages. The Worker's CORS becomes an allowlist driven by a Wrangler var.

**Tech Stack:** WXT 0.20 (`manifest` as `(env: ConfigEnv) => UserManifest`), `@wxt-dev/auto-icons` ^1.1, Hono 4 `cors({ origin: fn })`, Vitest 3 (+ `@cloudflare/vitest-pool-workers`), GitHub Actions (`pnpm/action-setup@v4`, `actions/setup-node@v4`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`), plain HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-09-26-chrome-web-store-publishing-design.md`

## Global Constraints

- Extension name: `DU ProfessorView`. Description: `Professor ratings on Drexel's Term Master Schedule and Banner registration (unofficial).`
- First store version: `1.0.0` (from `packages/extension/package.json`).
- Production `permissions`: exactly `["storage"]`. Production `host_permissions`: exactly `https://*.drexel.edu/*`, `https://www.ratemyprofessors.com/*`, `https://drexel-rmp-worker.mlhv.workers.dev/*`. No `key`, no localhost, no `*.workers.dev` wildcard.
- Development adds `http://localhost:8787/*` and the manifest `key` (only when the key is non-empty).
- Production Worker URL: `https://drexel-rmp-worker.mlhv.workers.dev`.
- Disclaimer text wherever branding appears publicly: `Not affiliated with or endorsed by Drexel University or Rate My Professors.`
- Icon: original mark; no Drexel dragon, no Drexel navy/gold, nothing resembling RMP branding.
- Privacy URL: `https://mlhv.github.io/drexel-rmp/privacy.html`. Any change that sends or stores new data updates `site/privacy.html` and `docs/store/listing.md` in the same PR.
- Worker CORS is hygiene, not access control; it must never break the extension. Deploys stay manual (`wrangler deploy` run by the user — auto mode blocks it).
- Commit messages have no `Co-Authored-By` trailer.
- Run tests with `pnpm -F <pkg> test` (vitest run mode, never watch).
- After each task's review passes, write a learning walkthrough to `docs/learning/task-NN.md` (continuing from task-13, so this plan's tasks are task-14 … task-19) and commit it as `docs: learning notes for task NN`.

## Review Focus

- Empty or whitespace-only `EXTENSION_PUBLIC_KEY` (the state before bootstrap) → dev manifest omits `key` rather than emitting `"key": ""` (which Chrome rejects on load). Pinned in Task 1.
- Empty/whitespace `WXT_WORKER_URL` (e.g. a blank line in `.env.local`) → falls back to the production URL, not to `""` (which would make every Worker fetch hit a relative URL). Pinned in Task 1.
- `ALLOWED_ORIGIN` empty (the state before bootstrap) with a request carrying no `Origin` header → no `Access-Control-Allow-Origin` header at all (a naive `origin === allowed` check matches `"" === ""`). Pinned in Task 6.
- CORS preflight (`OPTIONS`) from the allowed origin → 204 with ACAO; from a foreign origin → no ACAO. Pinned in Task 6.
- Release tag not matching `package.json` version (e.g. tag `v1.0.1`, version `1.0.0`) → release job fails before building. Verified locally in Task 3.

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/extension/lib/manifest.ts` (create) | `PROD_WORKER_URL`, `EXTENSION_PUBLIC_KEY`, pure `buildManifest(mode, publicKey)` |
| `packages/extension/lib/manifest.test.ts` (create) | Manifest guard tests |
| `packages/extension/lib/config.ts` (modify) | `resolveWorkerUrl()`; `WORKER_URL` from `import.meta.env.WXT_WORKER_URL` |
| `packages/extension/lib/config.test.ts` (create) | `resolveWorkerUrl` tests |
| `packages/extension/wxt.config.ts` (modify) | Wires `buildManifest`, auto-icons module, zip name |
| `packages/extension/assets/icon.svg` (create) | Single icon source |
| `.github/workflows/ci.yml`, `release.yml`, `pages.yml` (create) | CI, tagged release zip, Pages deploy |
| `site/index.html`, `site/privacy.html`, `site/style.css` (create) | Public landing + privacy policy |
| `docs/store/listing.md`, `docs/store/runbook.md` (create) | Dashboard copy; user-performed submission checklist |
| `packages/worker/src/index.ts`, `wrangler.toml`, `test/env.d.ts`, `test/prof.test.ts` (modify) | CORS allowlist + tests |

---

### Task 1: Mode-aware manifest and env-driven Worker URL

**Files:**
- Create: `packages/extension/lib/manifest.ts`, `packages/extension/lib/manifest.test.ts`, `packages/extension/lib/config.test.ts`
- Modify: `packages/extension/lib/config.ts`, `packages/extension/wxt.config.ts`, `.gitignore`, `docs/testing-checklist.md`, `README.md`

**Interfaces:**
- Produces: `PROD_WORKER_URL: string`, `EXTENSION_PUBLIC_KEY: string`, `buildManifest(mode: string, publicKey?: string): UserManifest` from `lib/manifest.ts`; `resolveWorkerUrl(override: string | undefined): string` and `WORKER_URL` from `lib/config.ts` (`WORKER_URL` keeps its existing name — `entrypoints/background.ts` already imports it).
- `lib/manifest.ts` must not reference `import.meta.env` or `wxt/*` runtime modules: `wxt.config.ts` imports it while the config is loaded by Node, before Vite exists.

- [ ] **Step 1: Write the failing manifest tests**

Create `packages/extension/lib/manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest";

const PROD_HOSTS = [
  "https://*.drexel.edu/*",
  "https://www.ratemyprofessors.com/*",
  "https://drexel-rmp-worker.mlhv.workers.dev/*",
];

describe("buildManifest", () => {
  it("production: exact store permissions, no key, no localhost", () => {
    // Guard test: a permission change must be a deliberate edit here — reviewers
    // compare the store listing's justifications against this list.
    expect(buildManifest("production", "SOME_KEY")).toEqual({
      name: "DU ProfessorView",
      description:
        "Professor ratings on Drexel's Term Master Schedule and Banner registration (unofficial).",
      permissions: ["storage"],
      host_permissions: PROD_HOSTS,
    });
  });

  it("development: adds localhost and the key", () => {
    const m = buildManifest("development", "SOME_KEY");
    expect(m.host_permissions).toEqual([...PROD_HOSTS, "http://localhost:8787/*"]);
    expect(m.key).toBe("SOME_KEY");
  });

  it("development before bootstrap: empty or blank key is omitted, not emitted as \"\"", () => {
    expect(buildManifest("development", "")).not.toHaveProperty("key");
    expect(buildManifest("development", "  \n")).not.toHaveProperty("key");
  });

  it("any non-development mode is treated as production", () => {
    expect(buildManifest("staging", "SOME_KEY")).toEqual(buildManifest("production", "SOME_KEY"));
  });
});
```

Create `packages/extension/lib/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveWorkerUrl } from "./config";
import { PROD_WORKER_URL } from "./manifest";

describe("resolveWorkerUrl", () => {
  it("defaults to the production Worker", () => {
    expect(resolveWorkerUrl(undefined)).toBe(PROD_WORKER_URL);
  });

  it("uses an override such as a local wrangler dev server", () => {
    expect(resolveWorkerUrl("http://localhost:8787")).toBe("http://localhost:8787");
  });

  it("treats an empty or blank override as unset", () => {
    expect(resolveWorkerUrl("")).toBe(PROD_WORKER_URL);
    expect(resolveWorkerUrl("   ")).toBe(PROD_WORKER_URL);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @drexel-rmp/extension test -- lib/manifest.test.ts lib/config.test.ts`
Expected: FAIL — `Cannot find module './manifest'` / `resolveWorkerUrl` is not exported.

- [ ] **Step 3: Implement `lib/manifest.ts`**

```ts
import type { UserManifest } from "wxt";

/** Deployed Cloudflare Worker base URL (see packages/worker/README.md). */
export const PROD_WORKER_URL = "https://drexel-rmp-worker.mlhv.workers.dev";

/**
 * The Chrome Web Store item's public key (Dashboard → Package → "View public key",
 * base64 body only). Dev builds embed it so unpacked installs share the store ID.
 * Empty until the runbook's bootstrap step (docs/store/runbook.md).
 */
export const EXTENSION_PUBLIC_KEY = "";

const PROD_HOST_PERMISSIONS = [
  "https://*.drexel.edu/*",
  "https://www.ratemyprofessors.com/*",
  `${PROD_WORKER_URL}/*`,
];

/**
 * Manifest for a build mode. Only "development" gets localhost and `key`:
 * the Web Store rejects uploads containing `key`, and localhost is dev-only.
 */
export function buildManifest(mode: string, publicKey = EXTENSION_PUBLIC_KEY): UserManifest {
  const manifest: UserManifest = {
    name: "DU ProfessorView",
    description:
      "Professor ratings on Drexel's Term Master Schedule and Banner registration (unofficial).",
    permissions: ["storage"],
    host_permissions: [...PROD_HOST_PERMISSIONS],
  };
  if (mode !== "development") return manifest;

  manifest.host_permissions!.push("http://localhost:8787/*");
  const key = publicKey.trim();
  if (key) manifest.key = key;
  return manifest;
}
```

If `UserManifest` lacks a `key` property in WXT's types, widen locally with `const manifest: UserManifest & { key?: string }` and return type `UserManifest & { key?: string }` — do not use `any`.

- [ ] **Step 4: Update `lib/config.ts`**

Replace the `WORKER_URL` block (lines 1–5) so the file reads:

```ts
import { PROD_WORKER_URL } from "./manifest";

/** An override (e.g. a local `wrangler dev` server) wins; blank means unset. */
export function resolveWorkerUrl(override: string | undefined): string {
  return override?.trim() || PROD_WORKER_URL;
}

/**
 * Worker base URL. For a local Worker, put `WXT_WORKER_URL=http://localhost:8787`
 * in packages/extension/.env.local (untracked) and run the dev build.
 */
export const WORKER_URL = resolveWorkerUrl(import.meta.env.WXT_WORKER_URL);
export const WORKER_TIMEOUT_MS = 3000;
/** Direct RMP is the last network layer; without a cap a hung request would block the lookup forever. */
export const DIRECT_TIMEOUT_MS = 5000;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @drexel-rmp/extension test`
Expected: all extension tests PASS (new + existing).

- [ ] **Step 6: Wire `wxt.config.ts`**

```ts
import { defineConfig } from "wxt";
import { buildManifest } from "./lib/manifest";

export default defineConfig({
  manifest: ({ mode }) => buildManifest(mode),
});
```

- [ ] **Step 7: Verify built manifests**

Run: `pnpm -F @drexel-rmp/extension build && cat packages/extension/.output/chrome-mv3/manifest.json`
Expected: `host_permissions` is exactly the three production hosts; no `key`; no `localhost`.

Run: `pnpm -F @drexel-rmp/extension exec wxt build --mode development && ls packages/extension/.output/`
Then `cat` the `manifest.json` inside the new dev output directory (WXT names it `chrome-mv3-dev`; use whatever directory appeared).
Expected: includes `http://localhost:8787/*`; no `key` (public key still empty).

- [ ] **Step 8: Ignore local env files and update docs**

Append to `.gitignore`:

```
.env*.local
```

In `docs/testing-checklist.md`, replace the kill-switch item with:

```md
- [ ] Kill switch drill: `WXT_WORKER_URL=https://nonexistent.invalid pnpm -F @drexel-rmp/extension build`,
      reload the extension → badges still appear (direct RMP fallback). Rebuild normally after.
```

In `README.md`'s Develop section, after the `worker dev` line, add:

```md
To point a dev build at the local Worker, create `packages/extension/.env.local`
containing `WXT_WORKER_URL=http://localhost:8787`.
```

- [ ] **Step 9: Commit**

```bash
git add packages/extension/lib/manifest.ts packages/extension/lib/manifest.test.ts \
  packages/extension/lib/config.ts packages/extension/lib/config.test.ts \
  packages/extension/wxt.config.ts .gitignore docs/testing-checklist.md README.md
git commit -m "feat(extension): mode-aware manifest with exact store permissions"
```

---

### Task 2: DU ProfessorView branding, icons, version 1.0.0

**Files:**
- Create: `packages/extension/assets/icon.svg`
- Modify: `packages/extension/wxt.config.ts`, `packages/extension/package.json`, `README.md`, `pnpm-lock.yaml`, possibly `pnpm-workspace.yaml`

**Interfaces:**
- Consumes: `buildManifest` (Task 1) — name/description already set there.
- Produces: store zip named `du-professorview-<version>-chrome.zip` in `packages/extension/.output/` (Task 3's release workflow globs `du-professorview-*-chrome.zip`); icons at `icons/{16,32,48,128}.png` in the build output.

- [ ] **Step 1: Add the icon source**

Create `packages/extension/assets/icon.svg` (teal tile, white lens with a star — original mark, no Drexel/RMP colors or shapes):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#0F766E"/>
  <circle cx="54" cy="54" r="32" fill="none" stroke="#FFFFFF" stroke-width="10"/>
  <line x1="78" y1="78" x2="106" y2="106" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round"/>
  <path d="M54 34l5.9 12 13.2 1.9-9.6 9.3 2.3 13.1-11.8-6.2-11.8 6.2 2.3-13.1-9.6-9.3 13.2-1.9z" fill="#FFFFFF"/>
</svg>
```

- [ ] **Step 2: Install auto-icons**

Run: `pnpm -F @drexel-rmp/extension add -D @wxt-dev/auto-icons@^1.1.0`

- [ ] **Step 3: Configure modules, icon source, and zip name**

`packages/extension/wxt.config.ts`:

```ts
import { defineConfig } from "wxt";
import { buildManifest } from "./lib/manifest";

export default defineConfig({
  modules: ["@wxt-dev/auto-icons"],
  autoIcons: { baseIconPath: "assets/icon.svg" },
  manifest: ({ mode }) => buildManifest(mode),
  zip: { artifactTemplate: "du-professorview-{{version}}-{{browser}}.zip" },
});
```

Set `"version": "1.0.0"` in `packages/extension/package.json`.

- [ ] **Step 4: Build and verify icons + zip**

Run: `pnpm -F @drexel-rmp/extension zip && ls packages/extension/.output packages/extension/.output/chrome-mv3/icons && grep -A6 '"icons"' packages/extension/.output/chrome-mv3/manifest.json && grep '"version"' packages/extension/.output/chrome-mv3/manifest.json`
Expected: `du-professorview-1.0.0-chrome.zip` exists; `icons/` has 16/32/48/128 PNGs; manifest has an `icons` map; version `1.0.0`.

Troubleshooting: auto-icons renders via `sharp`, which `pnpm-workspace.yaml` lists under `allowBuilds` as `false`. Recent sharp ships prebuilt binaries and normally needs no install script. If the build errors loading sharp, set `sharp: true` in `allowBuilds`, run `pnpm install`, rebuild, and include `pnpm-workspace.yaml` in the commit. If sharp cannot rasterize the SVG, report BLOCKED rather than switching icon strategy.

Open `packages/extension/.output/chrome-mv3/icons/128.png` and `16.png` with the Read tool and confirm the lens and star are recognizable.

- [ ] **Step 5: Run all extension tests**

Run: `pnpm -F @drexel-rmp/extension test`
Expected: PASS.

- [ ] **Step 6: Update README**

Replace the README's first paragraph with:

```md
**DU ProfessorView** — Chrome extension showing Rate My Professors ratings inline on
Drexel's Term Master Schedule and Banner registration pages, backed by a Cloudflare
Worker KV cache with direct-to-RMP fallback.

Not affiliated with or endorsed by Drexel University or Rate My Professors.
```

- [ ] **Step 7: Commit**

```bash
git add packages/extension/assets/icon.svg packages/extension/wxt.config.ts \
  packages/extension/package.json pnpm-lock.yaml README.md
# plus pnpm-workspace.yaml if the sharp troubleshooting applied
git commit -m "feat(extension): DU ProfessorView branding, generated icons, v1.0.0"
```

---

### Task 3: CI and tagged release workflows

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: zip name `du-professorview-<version>-chrome.zip` (Task 2); root `pnpm test` / `pnpm build` scripts.

- [ ] **Step 1: Pin pnpm**

Add to root `package.json` (top level, after `"private": true`), using the exact local version from `pnpm --version` (currently `11.10.0`):

```json
"packageManager": "pnpm@11.10.0",
```

- [ ] **Step 2: Verify the local commands CI will run**

Run: `pnpm install --frozen-lockfile && pnpm test && pnpm build`
Expected: install succeeds without lockfile changes; all packages' tests PASS; build succeeds (shared/worker typecheck, extension production build).

- [ ] **Step 3: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 4: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Tag must match extension version
        run: |
          PKG_VERSION=$(node -p "require('./packages/extension/package.json').version")
          if [ "${GITHUB_REF_NAME#v}" != "$PKG_VERSION" ]; then
            echo "::error::Tag $GITHUB_REF_NAME does not match packages/extension version $PKG_VERSION"
            exit 1
          fi

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm -F @drexel-rmp/extension zip

      - name: Create GitHub Release with store zip
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" packages/extension/.output/du-professorview-*-chrome.zip --generate-notes
```

- [ ] **Step 5: Verify the tag check locally (Review Focus: mismatched tag)**

Run each and confirm the outcome:

```bash
check() { PKG_VERSION=$(node -p "require('./packages/extension/package.json').version"); if [ "${GITHUB_REF_NAME#v}" != "$PKG_VERSION" ]; then echo "FAIL $GITHUB_REF_NAME"; else echo "OK $GITHUB_REF_NAME"; fi; }
GITHUB_REF_NAME=v1.0.0 check   # Expected: OK v1.0.0
GITHUB_REF_NAME=v1.0.1 check   # Expected: FAIL v1.0.1
GITHUB_REF_NAME=1.0.0 check    # Expected: OK 1.0.0 (only v* tags trigger the workflow anyway)
```

- [ ] **Step 6: Validate workflow YAML parses**

Run: `for f in .github/workflows/ci.yml .github/workflows/release.yml; do pnpm dlx js-yaml "$f" > /dev/null && echo "ok $f"; done`
Expected: `ok` for both files (js-yaml exits non-zero with a line number on a parse error).

- [ ] **Step 7: Commit**

```bash
git add package.json .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: test/build on push; build store zip into a GitHub Release on v* tags"
```

Do not push or create tags — the user does that per the runbook.

---

### Task 4: GitHub Pages site (landing + privacy policy)

**Files:**
- Create: `site/index.html`, `site/privacy.html`, `site/style.css`, `.github/workflows/pages.yml`

**Interfaces:**
- Produces: privacy URL `https://mlhv.github.io/drexel-rmp/privacy.html` (referenced by Task 5's listing).

Note on the spec's "one screenshot" for the landing page: real screenshots only exist after the user captures them (runbook). The page instead shows an HTML/CSS sample row with a badge so it's complete now; the runbook's final step optionally swaps in a real screenshot.

- [ ] **Step 1: Create `site/style.css`**

```css
:root {
  --bg: #ffffff;
  --fg: #1f2937;
  --muted: #6b7280;
  --card: #f3f4f6;
  --accent: #0f766e;
  --good: #15803d;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111827;
    --fg: #e5e7eb;
    --muted: #9ca3af;
    --card: #1f2937;
    --accent: #2dd4bf;
    --good: #4ade80;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
header { display: flex; align-items: center; gap: 0.75rem; }
header img { width: 48px; height: 48px; }
h1 { margin: 0; font-size: 1.75rem; }
h2 { margin-top: 2rem; font-size: 1.2rem; }
a { color: var(--accent); }
.tagline { color: var(--muted); margin-top: 0.25rem; }
.cta {
  display: inline-block; margin: 1.5rem 0; padding: 0.6rem 1.1rem;
  background: var(--accent); color: var(--bg); border-radius: 8px;
  text-decoration: none; font-weight: 600;
}
.sample {
  background: var(--card); border-radius: 10px; padding: 1rem;
  overflow-x: auto; font-size: 0.95rem;
}
.sample table { border-collapse: collapse; width: 100%; }
.sample td { padding: 0.35rem 0.5rem; white-space: nowrap; }
.badge {
  display: inline-block; margin-left: 0.4rem; padding: 0 0.4rem;
  border-radius: 4px; background: var(--good); color: var(--bg);
  font-weight: 600; font-size: 0.85em;
}
footer { margin-top: 3rem; color: var(--muted); font-size: 0.9rem; }
```

- [ ] **Step 2: Create `site/index.html`**

Copy the icon for the page header: `cp packages/extension/assets/icon.svg site/icon.svg`.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DU ProfessorView</title>
  <meta name="description" content="Professor ratings on Drexel's course pages (unofficial Chrome extension).">
  <link rel="icon" href="icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="style.css">
</head>
<body>
<main>
  <header>
    <img src="icon.svg" alt="">
    <div>
      <h1>DU ProfessorView</h1>
      <div class="tagline">Professor ratings on Drexel course pages (unofficial)</div>
    </div>
  </header>

  <p>A Chrome extension that shows Rate My Professors ratings next to instructor
  names on Drexel's Term Master Schedule and Banner class registration pages.
  Hover a badge for difficulty, would-take-again percentage, and the number of ratings.</p>

  <a class="cta" href="https://github.com/mlhv/drexel-rmp">Add to Chrome</a>

  <div class="sample" aria-label="Example of a course row with a rating badge">
    <table>
      <tr><td>CS 164</td><td>Introduction to Computer Science</td><td>Smith, Jane<span class="badge">★ 4.3</span></td></tr>
    </table>
  </div>

  <h2>How it works</h2>
  <p>The extension reads instructor names on the Drexel pages you open and looks up
  their public ratings. It never sees your Drexel password, your schedule, or anything
  else on the page. Details are in the <a href="privacy.html">privacy policy</a>.</p>

  <h2>Source</h2>
  <p>Open source on <a href="https://github.com/mlhv/drexel-rmp">GitHub</a>.
  Bug reports and questions: <a href="https://github.com/mlhv/drexel-rmp/issues">GitHub Issues</a>.</p>

  <footer>Not affiliated with or endorsed by Drexel University or Rate My Professors.</footer>
</main>
</body>
</html>
```

(The "Add to Chrome" link points at the repo until the listing exists; runbook step 6 swaps in the store URL.)

- [ ] **Step 3: Create `site/privacy.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Privacy Policy · DU ProfessorView</title>
  <link rel="icon" href="icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="style.css">
</head>
<body>
<main>
  <p><a href="./">← DU ProfessorView</a></p>
  <h1>Privacy Policy</h1>
  <p class="tagline">Effective September 26, 2026</p>

  <p>DU ProfessorView is a Chrome extension that shows Rate My Professors ratings
  next to instructor names on Drexel University course pages. This policy describes
  exactly what data it handles.</p>

  <h2>What the extension sends</h2>
  <p>Only <strong>instructor names</strong> found on the Drexel Term Master Schedule
  and Banner registration pages you visit. To look up ratings, those names are sent to:</p>
  <ul>
    <li>the extension's own rating cache service, hosted on Cloudflare Workers
      (<code>drexel-rmp-worker.mlhv.workers.dev</code>), and</li>
    <li>ratemyprofessors.com, when the cache service is unavailable or has no entry.</li>
  </ul>

  <h2>What the extension does not collect</h2>
  <ul>
    <li>Your Drexel username, password, or any login information</li>
    <li>Your name, email, student ID, or any other identity information</li>
    <li>Your courses, schedule, grades, or registration activity</li>
    <li>Your browsing history or activity on any other website</li>
  </ul>
  <p>There are no analytics, no advertising, and no tracking. No data is sold or
  shared with anyone for any other purpose.</p>

  <h2>What is stored</h2>
  <ul>
    <li><strong>On your device:</strong> rating results are cached in your browser's
      extension storage for about 24 hours so repeat lookups are fast. Removing the
      extension deletes this cache.</li>
    <li><strong>In the cache service:</strong> instructor name → rating results are
      stored for 1–7 days. These records contain no information about you.
      Cloudflare's standard infrastructure request logging applies to the service
      (see Cloudflare's privacy policy).</li>
  </ul>

  <h2>Changes</h2>
  <p>If the extension ever handles new data, this page will be updated before that
  version is released, and the effective date above will change.</p>

  <h2>Contact</h2>
  <p>Questions: <a href="https://github.com/mlhv/drexel-rmp/issues">GitHub Issues</a>.</p>

  <footer>Not affiliated with or endorsed by Drexel University or Rate My Professors.</footer>
</main>
</body>
</html>
```

- [ ] **Step 4: Check the privacy claims against the code**

Run: `grep -rn "fetch(\|storage\.\(local\|sync\|session\)" packages/extension/entrypoints packages/extension/lib packages/extension/components --include=*.ts | grep -v test`
Expected: only Worker/RMP fetches (via `workerClient.ts` and shared `lookupProfessorViaRmp`) and `storage.local` in `cache.ts`. If anything else appears (another host, `storage.sync`, other data), stop and report — the policy would be inaccurate.

Also confirm the local TTL and Worker TTLs match the page: `grep -n "TTL\|24" packages/extension/lib/cache.ts packages/worker/src/index.ts`.

- [ ] **Step 5: Preview locally**

Run: `python3 -m http.server -d site 8123` in the background, then fetch `http://localhost:8123/`, `/privacy.html`, `/style.css`, `/icon.svg` (e.g. `curl -sI`) and confirm 200s. Stop the server.

- [ ] **Step 6: Create `.github/workflows/pages.yml`**

```yaml
name: Pages

on:
  push:
    branches: [main]
    paths: ["site/**"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 7: Commit**

```bash
git add site .github/workflows/pages.yml
git commit -m "feat(site): landing page and privacy policy on GitHub Pages"
```

---

### Task 5: Store listing copy and submission runbook

**Files:**
- Create: `docs/store/listing.md`, `docs/store/runbook.md`
- Modify: `docs/testing-checklist.md`, `README.md`

**Interfaces:**
- Consumes: privacy URL (Task 4), `EXTENSION_PUBLIC_KEY` in `packages/extension/lib/manifest.ts` (Task 1), `ALLOWED_ORIGIN` var in `packages/worker/wrangler.toml` (Task 6), release workflow (Task 3).

- [ ] **Step 1: Create `docs/store/listing.md`**

```md
# Chrome Web Store listing — DU ProfessorView

Paste these into the Developer Dashboard. Keep in sync with `site/privacy.html`
and `packages/extension/lib/manifest.ts`: any change to data handled or
permissions updates this file in the same PR.

## Store listing tab

**Name:** DU ProfessorView (from the manifest)

**Short description (manifest `description`, ≤132 chars):**
Professor ratings on Drexel's Term Master Schedule and Banner registration (unofficial).

**Detailed description:**

See Rate My Professors ratings right next to instructor names while you browse
Drexel's Term Master Schedule and register for classes in Banner.

• A color-coded ★ badge next to each instructor
• Hover for difficulty, would-take-again %, and number of ratings
• One click to the professor's full Rate My Professors page
• Multi-instructor sections get one badge per instructor
• If no confident match exists, you see "n/a" — never the wrong professor's rating

Privacy: the extension only reads instructor names on Drexel course pages to look
up their public ratings. No login data, no schedule, no browsing history, no
analytics. Full policy: https://mlhv.github.io/drexel-rmp/privacy.html

Open source: https://github.com/mlhv/drexel-rmp

Not affiliated with or endorsed by Drexel University or Rate My Professors.

**Category:** Education
**Language:** English

## Privacy practices tab

**Single purpose:**
Displays Rate My Professors ratings next to instructor names on Drexel's course
schedule and registration pages.

**Permission justifications:**
- `storage`: Caches rating lookups locally so the same professor isn't looked up again on every page load.
- Host `https://*.drexel.edu/*`: Reads instructor names on Drexel's Term Master Schedule and Banner registration pages to place rating badges next to them.
- Host `https://www.ratemyprofessors.com/*`: Fetches public professor ratings.
- Host `https://drexel-rmp-worker.mlhv.workers.dev/*`: The extension's own cache service for professor ratings, which reduces requests to Rate My Professors.

**Remote code:** No, I am not using remote code. (The cache service returns JSON data only; all executable code ships in the package.)

**Data usage — collected types:** Website content (instructor names read from Drexel course pages). No other category.

**Certifications (check all three):**
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://mlhv.github.io/drexel-rmp/privacy.html

## Distribution tab

**Visibility:** Unlisted (switch to Public per `runbook.md` go-public criteria)
**Regions:** All regions

## Assets

- Store icon: 128×128 — `packages/extension/.output/chrome-mv3/icons/128.png` after a production build
- Screenshots: ≥1 at 1280×800, captured by you from logged-in TMS/Banner pages; crop out your name, schedule, and anything personal
- Small promo tile 440×280: only if the dashboard requires it — the icon centered on a `#0F766E` background
```

- [ ] **Step 2: Create `docs/store/runbook.md`**

```md
# Chrome Web Store submission runbook

Steps only you can do (accounts, login, deploys). Work top to bottom; check items off.

## 1. One-time accounts
- [ ] Register a Chrome Web Store developer account at https://chrome.google.com/webstore/devconsole ($5 one-time; 2-step verification required on the Google account).
- [ ] GitHub repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**. Then Actions → Pages → Run workflow (or push a change under `site/`).
- [ ] Confirm https://mlhv.github.io/drexel-rmp/privacy.html loads.

## 2. Bootstrap the extension ID
The store assigns the ID on first upload. Dev builds and the Worker CORS allowlist need it.
- [ ] `pnpm -F @drexel-rmp/extension zip`
- [ ] Dashboard → New item → upload `packages/extension/.output/du-professorview-1.0.0-chrome.zip`. Do **not** submit; leave it as a draft.
- [ ] Copy the item ID (32 letters, shown on the item page).
- [ ] Item → Package → "View public key". Copy the key body (between the BEGIN/END lines, joined into one line).
- [ ] Paste the key into `EXTENSION_PUBLIC_KEY` in `packages/extension/lib/manifest.ts`.
- [ ] Set `ALLOWED_ORIGIN = "chrome-extension://<item id>"` in `packages/worker/wrangler.toml`.
- [ ] `pnpm test`, then commit: `chore: record Chrome Web Store extension ID`.
- [ ] `pnpm -F @drexel-rmp/worker deploy`.
- [ ] `pnpm -F @drexel-rmp/extension exec wxt build --mode development`, load `packages/extension/.output/chrome-mv3-dev` unpacked, and confirm chrome://extensions shows the same ID as the store item.
- [ ] Remove that unpacked dev copy (two installs with one ID conflict).

## 3. Pre-release check
- [ ] Run `docs/testing-checklist.md` against the unpacked **production** build.

## 4. Release and submit
- [ ] Confirm `packages/extension/package.json` version is `1.0.0`.
- [ ] `git push && git tag v1.0.0 && git push origin v1.0.0`
- [ ] Wait for the Release workflow; download `du-professorview-1.0.0-chrome.zip` from the GitHub Release.
- [ ] Dashboard → the draft item → Package → upload the Release zip (replacing the bootstrap draft).
- [ ] Fill every tab from `docs/store/listing.md`; upload screenshots.
- [ ] Distribution → Visibility: **Unlisted**.
- [ ] Submit for review.

## 5. After approval
- [ ] Install from the store link; run `docs/testing-checklist.md` against the store install.
- [ ] Replace the "Add to Chrome" `href` in `site/index.html` with the store URL; optionally save a screenshot as `site/screenshot.png` and add it below the sample row; commit and push.

## 6. Go public (criteria decided in advance)
All must hold:
- [ ] ≥2 weeks unlisted without breakages
- [ ] Used through at least one real registration period
- [ ] No issues raised by Rate My Professors or Drexel

Then Distribution → Visibility: **Public**. Check at the time whether a visibility-only change triggers a new review.

## Later releases
Bump `packages/extension/package.json` version → commit → `git tag vX.Y.Z && git push origin vX.Y.Z` → upload the Release zip → submit.
```

- [ ] **Step 3: Update the testing checklist**

In `docs/testing-checklist.md`, add after the "Setup" paragraph:

```md
Run this list twice per release: on the unpacked production build before tagging,
and on the store install after approval.
```

and add this item at the end of the list:

```md
- [ ] Store install only: extension ID matches the dev build's ID (chrome://extensions)
```

- [ ] **Step 4: Link from README**

In `README.md`'s "Release checks" section, append:

```md
Chrome Web Store submission: `docs/store/runbook.md` (listing copy in `docs/store/listing.md`).
```

- [ ] **Step 5: Consistency check**

Run: `grep -n "drexel.edu\|ratemyprofessors\|workers.dev" docs/store/listing.md packages/extension/lib/manifest.ts site/privacy.html`
Expected: the three hosts in `listing.md` justifications match `PROD_HOST_PERMISSIONS` exactly; the privacy page names the same Worker host.

- [ ] **Step 6: Commit**

```bash
git add docs/store docs/testing-checklist.md README.md
git commit -m "docs(store): listing copy and submission runbook"
```

---

### Task 6: Worker CORS allowlist

**Files:**
- Modify: `packages/worker/src/index.ts`, `packages/worker/wrangler.toml`, `packages/worker/test/env.d.ts`, `packages/worker/test/prof.test.ts`

**Interfaces:**
- Produces: Wrangler var `ALLOWED_ORIGIN` (empty until runbook bootstrap sets `chrome-extension://<id>`).

- [ ] **Step 1: Add the var and test typing**

Append to `packages/worker/wrangler.toml`:

```toml

[vars]
# chrome-extension://<store item id>, set during docs/store/runbook.md bootstrap.
# Empty = no browser origin allowed (safe: the extension doesn't depend on CORS).
ALLOWED_ORIGIN = ""
```

`packages/worker/test/env.d.ts`:

```ts
declare module "cloudflare:test" {
  interface ProvidedEnv {
    RMP_CACHE: KVNamespace;
    ALLOWED_ORIGIN: string;
  }
}
```

- [ ] **Step 2: Write the failing CORS tests**

Append to `packages/worker/test/prof.test.ts`:

```ts
describe("CORS allowlist", () => {
  const EXT = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  const ACAO = "Access-Control-Allow-Origin";

  // Cached entry so these tests never touch RMP.
  const seed = () => env.RMP_CACHE.put("prof:cached prof", JSON.stringify({ status: "not_found" }));
  const get = (headers: Record<string, string> = {}) =>
    new Request("https://worker.test/prof?name=cached%20prof", { headers });

  it("echoes the allowed extension origin", async () => {
    await seed();
    const res = await app.fetch(get({ Origin: EXT }), { ...env, ALLOWED_ORIGIN: EXT });
    expect(res.headers.get(ACAO)).toBe(EXT);
  });

  it("omits the header for a foreign origin but still serves the body", async () => {
    await seed();
    const res = await app.fetch(get({ Origin: "https://evil.example" }), { ...env, ALLOWED_ORIGIN: EXT });
    expect(res.headers.get(ACAO)).toBeNull();
    expect(await res.json()).toEqual({ status: "not_found" });
  });

  it("requests without an Origin (curl, extension service worker) are unchanged", async () => {
    await seed();
    const res = await app.fetch(get(), { ...env, ALLOWED_ORIGIN: EXT });
    expect(res.status).toBe(200);
    expect(res.headers.get(ACAO)).toBeNull();
  });

  it("empty ALLOWED_ORIGIN allows nothing, even a request with no Origin", async () => {
    await seed();
    for (const headers of [{}, { Origin: EXT }]) {
      const res = await app.fetch(get(headers), { ...env, ALLOWED_ORIGIN: "" });
      expect(res.headers.get(ACAO)).toBeNull();
    }
  });

  it("preflight: allowed origin gets 204 + header; foreign origin gets no header", async () => {
    const preflight = (origin: string) =>
      new Request("https://worker.test/prof?name=x", {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
      });
    const ok = await app.fetch(preflight(EXT), { ...env, ALLOWED_ORIGIN: EXT });
    expect(ok.status).toBe(204);
    expect(ok.headers.get(ACAO)).toBe(EXT);

    const foreign = await app.fetch(preflight("https://evil.example"), { ...env, ALLOWED_ORIGIN: EXT });
    expect(foreign.headers.get(ACAO)).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm -F @drexel-rmp/worker test`
Expected: FAIL — current `cors()` sends `Access-Control-Allow-Origin: *`, so the foreign-origin, no-origin, and empty-allowlist assertions fail (`expected '*' to be null`).

- [ ] **Step 4: Implement the allowlist**

In `packages/worker/src/index.ts`, change the `Env` type and the `app.use` line:

```ts
type Env = { Bindings: { RMP_CACHE: KVNamespace; ALLOWED_ORIGIN?: string } };
```

```ts
// Hygiene, not access control: the extension's service worker is exempt from CORS
// via host_permissions, and CORS never stops non-browser clients. This only stops
// arbitrary websites from reading Worker responses from their pages.
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = c.env.ALLOWED_ORIGIN;
      // `allowed &&` guard: Hono passes "" when there's no Origin header, and "" === "" must not match.
      return allowed && origin === allowed ? origin : null;
    },
  }),
);
```

(`ALLOWED_ORIGIN` is optional in the type because the existing "KV is completely broken" test passes an env without it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @drexel-rmp/worker test && pnpm -F @drexel-rmp/worker build`
Expected: all worker tests PASS (existing + 5 new); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/index.ts packages/worker/wrangler.toml packages/worker/test/env.d.ts packages/worker/test/prof.test.ts
git commit -m "feat(worker): restrict CORS to the extension origin"
```

Do not run `wrangler deploy` — the user deploys during runbook bootstrap once `ALLOWED_ORIGIN` has a value.
