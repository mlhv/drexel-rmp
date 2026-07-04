# Drexel Rate My Professor Chrome Extension — Design

**Date:** 2026-07-04
**Status:** Approved

## Overview

A Chrome extension (Manifest V3) that injects Rate My Professors ratings next to instructor names on Drexel's course systems: the Term Master Schedule (termmasterschedule.drexel.edu) and Banner Self-Service registration (via DrexelOne). Both sites sit behind Drexel login; the extension runs in the student's authenticated session, so no credential handling is needed.

Distribution: personal/side-loaded first, Chrome Web Store later. Codebase is store-ready from day one (MV3, minimal permissions).

## Goals

- Show a professor's RMP rating inline while browsing/registering for courses, with detail on hover.
- Never disrupt the host page: failures are silent, styles are isolated.
- Never show a *wrong* professor's rating — prefer "no match" over a low-confidence guess.
- Maximize learning/resume value: real backend (Cloudflare Worker + KV cache), fallback/resilience design, monorepo with shared types.

## Architecture

pnpm monorepo, TypeScript everywhere:

```
drexel-rmp/
├─ pnpm-workspace.yaml
├─ packages/
│  ├─ extension/          # WXT (Vite-based extension framework)
│  │  ├─ wxt.config.ts    # generates manifest.json
│  │  ├─ entrypoints/
│  │  │  ├─ background.ts       # service worker: lookups, caching, fallback
│  │  │  ├─ tms.content.ts      # Term Master Schedule content script
│  │  │  └─ banner.content.ts   # Banner Self-Service content script
│  │  ├─ lib/
│  │  │  ├─ scanner.ts    # MutationObserver + DOM extraction
│  │  │  └─ names.ts      # name normalization (pure functions)
│  │  └─ components/      # badge + tooltip, vanilla TS in Shadow DOM
│  ├─ worker/              # Cloudflare Worker cache server
│  │  ├─ wrangler.toml
│  │  └─ src/index.ts     # Hono app + Workers KV
│  └─ shared/              # ProfessorRating type, RMP GraphQL queries,
│                          # Drexel school ID, match-scoring function
```

### Data flow

```
content script sees "Smith, John R" in the DOM
  → normalize name → message background service worker
      → layer 1: chrome.storage.local cache (~24h TTL, per device)
      → layer 2: Cloudflare Worker GET /prof?name=… (shared KV cache, 7-day TTL)
      → layer 3: RMP GraphQL direct (fallback, ~3s timeout on layer 2)
  → reply ProfessorRating | null
  → inject badge; hover shows tooltip
```

- Each layer falls through only on miss/failure; results propagate back up into the local cache.
- Background dedupes concurrent lookups for the same normalized name.
- All network access lives in the background service worker (content scripts cannot make cross-origin calls).

### RMP data source

RMP's unofficial GraphQL endpoint (`ratemyprofessors.com/graphql`), authenticated with the public hardcoded Basic header RMP's own site uses — no personal token exists to be revoked. Direct calls come from each user's own IP (block-resistant); the Worker exists as a shared cache to cut RMP traffic and speed up repeat lookups, not as a required gateway. Search is scoped to Drexel's RMP school ID.

### Name matching

Drexel renders "Smith, John R"; RMP stores "John Smith". Pipeline:

1. Normalize (reorder "Last, First", strip middle initials/titles, split multi-instructor cells, skip "STAFF"/"TBD").
2. Search RMP by normalized name scoped to Drexel's school ID.
3. Score candidates with a similarity function (shared package, used identically by Worker and direct path).
4. Below a confidence threshold → return "not found" rather than a wrong professor.

## Components

### Extension

- **background.ts** — listens for `LOOKUP_PROFESSOR` messages; three-layer lookup; in-flight request deduplication; replies `ProfessorRating | null`.
- **tms.content.ts / banner.content.ts** — thin per-site scripts scoped by URL pattern; each holds only that site's DOM selectors (one config object per site) and delegates to shared lib modules.
- **lib/scanner.ts** — MutationObserver-driven (both sites render dynamically); finds instructor elements; marks processed nodes with a `data-` attribute to prevent double injection.
- **lib/names.ts** — pure normalization functions; the primary unit-test surface.
- **components/badge.ts** — compact `★ 4.2` badge, color-coded green/yellow/red by rating, rendered in a Shadow DOM root for style isolation. No-match → subtle gray "n/a" badge linking to an RMP search (distinguishes "not found" from "broken").
- **components/tooltip.ts** — hover card via `@floating-ui/dom`: difficulty, would-take-again %, rating count, link to full RMP profile.

### Worker

- **GET /prof?name=<normalized>** (Hono): KV hit → return; miss → RMP GraphQL → score match → store in KV (7-day TTL; negative results 1-day TTL) → return JSON. CORS restricted to the extension's origin.

### Shared

- `ProfessorRating` type: name, rating, difficulty, wouldTakeAgain, numRatings, rmpUrl/legacyId.
- RMP GraphQL query strings + response validator.
- Drexel school ID constant.
- Match-scoring function (same result on both lookup paths).

### Manifest (generated by WXT from wxt.config.ts)

- Permissions: `storage`.
- Host permissions: the two Drexel domains, `ratemyprofessors.com`, the Worker's domain.
- Content scripts and service worker registered per entrypoints above.

## Error handling

Principle: the extension decorates someone else's page — failures must be invisible, never disruptive.

| Failure | Behavior |
|---|---|
| Worker down/slow | ~3s timeout, silent fallback to RMP direct |
| RMP direct also fails | Badge simply absent for uncached professors; cached ones render; expired local cache entries are served when the network is down (stale beats nothing) |
| Drexel DOM redesign | Scanner finds nothing, does nothing; fix = update one selector config |
| Low-confidence match | Show "n/a", never guess |
| RMP schema change | Shared query + validator → clean "no data" everywhere; Worker patchable instantly without store review |

## Testing

- **Unit (Vitest), the bulk:** name normalization + match scoring (edge cases: "Smith, John R", "STAFF", "TBD", multi-instructor cells, hyphenated names); scanner tested against committed HTML fixtures captured from real TMS/Banner DOM via devtools (repeatable, no login needed).
- **Worker:** Vitest + `@cloudflare/vitest-pool-workers` (real Workers runtime with KV), RMP responses mocked.
- **E2E:** manual checklist per release (load unpacked → TMS → badges render → tooltip opens → professor is correct). Automated login-wall E2E deferred.

## Out of scope (v1)

- Extension popup / settings UI
- Firefox or other browsers (WXT makes this easy later)
- Chrome Web Store publishing (planned later; design stays store-compatible)
- Automated authenticated E2E tests
