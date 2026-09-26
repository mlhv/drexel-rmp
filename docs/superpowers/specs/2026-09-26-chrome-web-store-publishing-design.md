# Chrome Web Store Publishing — Design

**Date:** 2026-09-26
**Status:** Draft (pending review)
**Parent spec:** [2026-07-04-drexel-rmp-extension-design.md](2026-07-04-drexel-rmp-extension-design.md) — this covers its deferred item "Chrome Web Store publishing".

## Overview

Ship the finished extension to the Chrome Web Store as **DU ProfessorView**, first as an **unlisted** listing (install by link), then switched to **public** once proven stable. Store zips are built by CI from tagged commits and attached to GitHub Releases; the upload itself is manual for the first submission (store API automation is a follow-up project).

## Goals

- Pass store review on the first or second attempt with minimal, exact permissions.
- Avoid trademark/affiliation problems with Drexel and Rate My Professors.
- Every store zip is reproducible: built by CI from a tagged commit, never from a laptop.
- Privacy disclosures match actual code behavior, and stay that way.

## Decisions

| Topic | Decision |
|---|---|
| Visibility | Unlisted first, then public (criteria in the runbook) |
| Release process | CI builds zip → GitHub Release; manual dashboard upload. Automated upload deferred |
| Name | "DU ProfessorView" — neutral brand; "Drexel" and "Rate My Professors" appear only descriptively |
| Privacy policy | GitHub Pages (`https://mlhv.github.io/drexel-rmp/privacy.html`), repo is public |
| Dev vs store builds | Mode-aware `wxt.config.ts` (single config file) |
| Worker CORS | Allowlist the extension origin as hygiene, not access control |

## 1. Extension manifest and build

**Identity**
- `name`: "DU ProfessorView"
- `description`: "Professor ratings on Drexel's Term Master Schedule and Banner registration (unofficial)."
- Version comes from `packages/extension/package.json` (WXT default); first store release is `1.0.0`.

**Mode-aware `wxt.config.ts`** — manifest computed from the build mode:

| | Production (`wxt build`, `wxt zip`) | Development (`wxt`) |
|---|---|---|
| `permissions` | `["storage"]` | `["storage"]` |
| `host_permissions` | `https://*.drexel.edu/*`, `https://www.ratemyprofessors.com/*`, `https://drexel-rmp-worker.mlhv.workers.dev/*` | production list + `http://localhost:8787/*` |
| `key` | absent | the store item's public key |

- The `key` is **dev-only** because the Web Store rejects uploaded manifests containing `key`. The store assigns the ID derived from that same key, so unpacked dev builds and the store build share one extension ID.
- The public key is obtained during the runbook bootstrap (Section 5). Until then the dev build omits `key` (config treats an empty value as absent).
- `WORKER_URL` in `lib/config.ts` becomes `import.meta.env.WXT_WORKER_URL ?? "https://drexel-rmp-worker.mlhv.workers.dev"`. Local Worker development sets `WXT_WORKER_URL=http://localhost:8787` in an untracked `.env.local`; the existing "use localhost" comment is updated to say so.
- The replaced wildcard `https://*.workers.dev/*` is removed entirely.

**Icons**
- One original source image: `packages/extension/assets/icon.svg`. `@wxt-dev/auto-icons` generates 16/32/48/128 PNGs at build time.
- Design: simple original mark (e.g. lens over a star), neutral palette. No Drexel dragon, no Drexel blue/gold, nothing resembling RMP's branding. Replacing this one file rebrands the icon everywhere.

**Manifest guard test**
- A Vitest test resolves the production manifest config and asserts: exact `permissions`, exact `host_permissions`, no `key`, no `localhost`. Any permission change must update this test deliberately, and CI fails otherwise.

## 2. Worker CORS

- `wrangler.toml` gains `[vars] ALLOWED_ORIGIN = ""`, set to `chrome-extension://<store id>` during bootstrap.
- `cors()` becomes `cors({ origin: (origin, c) => (origin === c.env.ALLOWED_ORIGIN ? origin : null) })` (exact form per Hono's API).
- Behavior:
  - Allowed origin → `Access-Control-Allow-Origin` echoed.
  - Other origins → no ACAO header; browsers block cross-site pages from reading responses. Body is still served (CORS is browser-enforced).
  - No `Origin` header (curl, extension service worker) → unchanged.
- Rationale, recorded as a code comment replacing the current TODO: extension service-worker fetches are exempt from CORS under `host_permissions`, and CORS never stops non-browser clients. The allowlist only prevents arbitrary websites from using the Worker from their pages. It is hygiene, not access control; it cannot break the extension even if misconfigured. With `ALLOWED_ORIGIN` empty, no browser origin is allowed.
- Deploy remains manual (`wrangler deploy` run by the user).

## 3. CI and releases

**`.github/workflows/ci.yml`** — on push to `main` and pull requests:
1. Checkout; `pnpm/action-setup`; `actions/setup-node` (Node LTS, pnpm cache).
2. `pnpm install --frozen-lockfile`
3. `pnpm test` (shared, worker, extension — includes the manifest guard test).
4. `pnpm -F @drexel-rmp/extension build` (production build).

Root `package.json` gains a `packageManager` field pinning the locally used pnpm version.

**`.github/workflows/release.yml`** — on push of tags matching `v*`:
1. Fail if the tag (minus `v`) ≠ `packages/extension/package.json` version.
2. Same install + test steps as CI.
3. `pnpm -F @drexel-rmp/extension zip` → `.output/<name>-<version>-chrome.zip`.
4. `gh release create <tag> <zip> --generate-notes` using the built-in `GITHUB_TOKEN` (workflow `permissions: contents: write`). No third-party release actions, no store credentials.

Release routine: bump version → commit → `git tag vX.Y.Z && git push --tags` → download zip from the Release → upload in the dashboard.

Worker deploys are not part of CI.

## 4. GitHub Pages site

- Source: top-level `site/` (not `docs/`, which holds internal specs and notes). Plain HTML + one CSS file, no framework, light/dark via `prefers-color-scheme`.
- Deploy: `.github/workflows/pages.yml` on pushes to `main` touching `site/**` (plus `workflow_dispatch`), using `actions/upload-pages-artifact` + `actions/deploy-pages`. One-time: repo Settings → Pages → Source: GitHub Actions.
- URL: `https://mlhv.github.io/drexel-rmp/`

**`site/index.html`** — what DU ProfessorView does, one screenshot, "Add to Chrome" link to the store listing (placeholder link to the GitHub repo until the listing URL exists), link to source, and the disclaimer: "Not affiliated with or endorsed by Drexel University or Rate My Professors."

**`site/privacy.html`** — must match the code:
- **Sent:** instructor names found on Drexel course pages the user visits, to the extension's Cloudflare Worker and to ratemyprofessors.com, solely to look up ratings.
- **Not collected:** Drexel credentials, user identity, courses/schedule, browsing history, analytics, tracking. Nothing sold or shared.
- **Stored:** ratings cached locally in `chrome.storage.local` (~24h). The Worker caches name → rating results (1–7 days) containing no user data. Cloudflare's standard infrastructure request logging applies.
- Contact: GitHub Issues. Effective date.

**Rule:** any change that makes the extension send or store new data must update `privacy.html` and `docs/store/listing.md` in the same PR.

## 5. Store listing and runbook

**`docs/store/listing.md`** — the exact dashboard text, versioned:
- Short description (≤132 chars) and full description (includes the non-affiliation disclaimer; names RMP and Drexel only descriptively).
- Single purpose: "Displays Rate My Professors ratings next to instructor names on Drexel's course schedule and registration pages."
- Permission justifications: `storage` (local rating cache); Drexel hosts (read instructor names on TMS and Banner pages); RMP and Worker hosts (fetch rating data).
- Remote code: **No** — the Worker returns JSON data, never executable code.
- Data usage: discloses website content (instructor names); certifies no sale/transfer, no unrelated use, no creditworthiness use; privacy URL.

**Assets:** 128px icon (from `icon.svg`); ≥1 screenshot at 1280×800, captured by the user from logged-in pages with personal info cropped out; 440×280 small promo tile rendered from the icon source if the dashboard requires it.

**`docs/store/runbook.md`** — user-performed checklist:
1. Register a Chrome Web Store developer account ($5 one-time, 2-step verification).
2. Enable GitHub Pages (Source: GitHub Actions); confirm the privacy URL loads.
3. **Bootstrap ID:** upload a first production zip as a draft; copy the item's public key into the dev manifest config and `chrome-extension://<id>` into `wrangler.toml` `ALLOWED_ORIGIN`; commit; `wrangler deploy`. Load the dev build unpacked and confirm its ID matches the store item.
4. Run `docs/testing-checklist.md` against the unpacked production build.
5. Tag `v1.0.0` → CI Release → upload that zip; fill the listing from `listing.md`; add screenshots; visibility **Unlisted**; submit for review.
6. After approval: install from the store link, re-run the testing checklist against the store build, and update `site/index.html` with the listing URL.
7. **Go-public criteria:** ≥2 weeks unlisted without breakage, at least one real registration period used, no issues raised by RMP or Drexel. Then switch visibility to Public (confirm at the time whether a visibility-only change triggers review).

## Implementation order

1. Mode-aware `wxt.config.ts`, env-driven `WORKER_URL`, manifest guard test.
2. Rename to DU ProfessorView; `icon.svg` + `@wxt-dev/auto-icons`; version `1.0.0`.
3. `ci.yml` + `packageManager` pin.
4. `release.yml` with tag/version check.
5. `site/` (index + privacy) + `pages.yml`.
6. `docs/store/listing.md` + `docs/store/runbook.md`.
7. Worker CORS allowlist + tests (value set during bootstrap).

Steps 1–7 are code/docs. Everything requiring the user's accounts or login (developer fee, bootstrap upload, screenshots, `wrangler deploy`, enabling Pages, submission) lives in the runbook.

## Testing

- **Unit:** manifest guard test; Worker CORS cases (allowed origin → header present; foreign origin → header absent, body served; no origin → unchanged) in the existing Workers-runtime Vitest suite.
- **CI:** every push proves tests pass and a production build succeeds.
- **Manual:** `docs/testing-checklist.md` gains an item "extension ID matches between dev build and store build"; run before tagging (unpacked production build) and after approval (store install).

## Out of scope

Each is a separate future spec:
- Automated store upload via the Chrome Web Store API (adds a step to `release.yml`)
- Popup / settings UI
- Firefox and other browsers
- Automated authenticated E2E tests
- Worker rate limiting / abuse protection
