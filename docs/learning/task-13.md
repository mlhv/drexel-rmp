# Learning notes — Task 13: Wiring it together and testing on the real sites

## What we built

```
Drexel page                          extension background              Cloudflare / RMP
─────────────────────────────        ──────────────────────           ────────────────
scanner finds "Daniel W Moix"
  → parseInstructorCell → "Daniel Moix"
  → empty slot inserted in the cell
  → sendMessage(LOOKUP_PROFESSOR) ──▶ local cache? Worker? RMP? ───▶ /prof, KV, GraphQL
  ← LookupResult ◀────────────────── (Task 10's chain)
  → createBadge → fill the slot
```

- `lib/inject.ts`: `runSite(config, lookup)`, the glue for scanner → names → lookup → badge.
- `entrypoints/tms.content.ts`, `entrypoints/banner.content.ts`: one content script per site, each just `runSite(<site config>)`.
- `docs/testing-checklist.md`, root `README.md`.

All 101 tests pass (shared 19, worker 5, extension 77), and you ran the full manual checklist on the live sites.

## Concept 1: Content scripts are thin; the logic lives in `lib/`

Each content script is 8 lines. Everything interesting is in `runSite`, which takes the lookup function as a parameter (defaulting to "message the background"). So the *entire* page-side flow is tested against your real HTML fixtures with a fake lookup: normalized names, placement, ordering, failure handling, all without a browser. It's the same dependency-injection idea as Tasks 4, 5 and 10, used here at the top level.

## Concept 2: Async results, sync order (placeholder slots)

A multi-instructor cell fires two lookups at once, and they finish in whatever order the network decides. Appending each badge when its lookup resolves would sometimes put Burlick's badge before Pirmann's. The fix is to reserve the position *synchronously*:

```ts
for (const name of names) {
  const slot = document.createElement("span");   // placed now, in name order
  el.appendChild(slot);
  void fillSlot(slot, name, lookup);             // filled whenever it resolves
}
```

If a lookup returns nothing or throws, the slot is removed, leaving the page exactly as it was. This "reserve the spot, fill later" pattern is how feeds and chat apps keep order with out-of-order network replies. A test resolves the second name first to prove it.

## Concept 3: Debugging from evidence (the Banner badge)

Banner showed no badges. There were three possible causes (script not running, selector mismatch, lookups failing), and each needed a different fix. Instead of guessing, a four-number console snippet split them:

```
instructorCells: 6, emailLinks: 6, processed: 6, badges: 6
```

Everything worked: the badges *existed* but weren't visible. That's a layout problem, not a logic one. Your screenshot added the key clue: `Brian Mitchell…` with an ellipsis.

**First hypothesis, which was wrong:** no line-break point between name and badge, so the badge couldn't wrap. Adding a space didn't help. That result was still useful: a failed fix rules out a hypothesis. Rather than guess again, the next step was to *measure*:

```
overflow: hidden, textOverflow: ellipsis, whiteSpace: nowrap, width: 86
```

`nowrap` means nothing in that cell can ever wrap, and 86px is about the width of "Brian Mitchell". Anything placed *after* the name is always clipped. The fix was to place the badge *before* the name (`badgePlacement: "before"`), because the start of a line is never clipped. We didn't restyle Banner's cell to make room, because changing host-page layout risks breaking their table (a project constraint).

Lessons: (1) when a fix doesn't work, go back to measuring before trying another; (2) tests couldn't catch this, because happy-dom doesn't do layout, which is exactly why the manual checklist exists.

## Concept 4: What the manual checklist proved that tests couldn't

| Checked live | Why unit tests couldn't |
|---|---|
| Badges visible on both sites | real CSS and layout |
| Ratings match RMP pages | real RMP data and the real matcher |
| Tooltip not clipped, link clickable | real positioning and pointer movement |
| Local cache skips the network on reload | real `chrome.storage` and service worker |
| Kill switch: direct RMP works when the Worker is down | real RMP accepting extension-origin requests (the last unverified item since Task 10) |

A good test strategy is layered: many fast unit tests for logic, plus a short manual checklist for what only a real browser can show.

## Concept 5: Reading the Network tab (and what timing can't tell you)

The lookups run in the background service worker, so they appear in *its* DevTools (chrome://extensions → "service worker"), not the page's. Timing breakdown:

- **Queueing / stalled**: inside Chrome, before sending. Usually tiny.
- **Waiting for server response**: server time plus the network round trip. Your 579ms was a Worker miss (Worker → RMP → Worker); the rerun was much faster (a KV hit).

Timing is circumstantial evidence: a cold KV read at a new edge location can be slow too. The definite way is to have the server say what happened (e.g. an `X-Cache: HIT/MISS` response header).

## Concept 6: Why keep the Worker if direct RMP is faster?

Direct RMP took ~150ms. A Worker *miss* is slower because it's two hops, but a Worker *hit* is about as fast as direct. What the Worker buys:

- **Load on RMP scales with professors, not users**: ~1 call per professor per week instead of every student on every page. That matters for an unofficial API that could be locked down.
- **Fix without a release**: a Worker redeploy fixes everyone in a minute. An extension update waits for store review.
- **Privacy**: RMP sees Cloudflare, not each student's IP and lookups.

What direct buys: fewer hops, one less service to run, and requests from many home IPs that are harder to block (why it's the fallback). The trade-off depends on scale: for one user, direct-first would be fine; for a published extension, the Worker earns its place.

Cache lifetimes, end to end: local 24h → Worker 7 days (found) / 1 day (not found), measured from the first write, not refreshed on reads. So the oldest rating you could see is about 8 days.
