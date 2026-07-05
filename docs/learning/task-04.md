# Learning notes — Task 4: The RMP client (composition + dependency injection)

## What we built

`rmpClient.ts` — the module that actually *talks to RMP* and stitches Tasks 1–3 into one pipeline:

```
searchRmpTeachers(name)      → POST GraphQL query → parseTeacherSearchResponse → RmpTeacher[]
lookupProfessorViaRmp(name)  → search → pickBestMatch → filter zero-ratings → teacherToRating
teacherToRating(t)           → RmpTeacher (RMP's shape) → ProfessorRating (our shape)
```

## Concept 1: Dependency injection — the one idea that makes network code testable

Look at the signature:

```ts
async function searchRmpTeachers(name: string, fetchFn: typeof fetch = fetch)
```

The function doesn't *use* the global `fetch` directly — it accepts a fetch-shaped function as a parameter, **defaulting** to the real one. Production callers pass nothing and get real networking. Tests pass a fake:

```ts
const fetchFn = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
```

This is **dependency injection (DI)** in its simplest, framework-free form — no Spring/NestJS container, just a default parameter. What it buys us:

1. **Tests run offline, in milliseconds, deterministically.** No real HTTP in unit tests, ever — real networks are slow, flaky, and would hammer RMP on every test run.
2. **Tests can assert on the request we *send*** — the test literally destructures the mock's call args and checks the URL, method, `Authorization` header, and the GraphQL variables. We're not just testing "did it return data" but "did it ask correctly."
3. **Environment portability** — this same code will run inside a Cloudflare Worker (Task 5) and a Chrome service worker (Task 10). Both have a global `fetch`, but if either ever needs a customized one (Cloudflare's `fetchMock`, timeouts), the seam already exists.

`typeof fetch` is a nice TS trick worth noticing: instead of writing out fetch's complicated signature, we say "whatever type the real `fetch` has."

## Concept 2: GraphQL from the client side

REST says "GET /teachers?school=X". **GraphQL** says: POST one endpoint, send a *query document* describing exactly the fields you want:

```
query TeacherSearch($query: TeacherSearchQuery!) {
  newSearch { teachers(query: $query) { edges { node { legacyId avgRating ... } } } }
}
```

Things to internalize:
- The query travels as a **string** in a JSON body — `{ query, variables }`. Variables (`$query`) are GraphQL's parameterization: data stays out of the query text, like SQL prepared statements.
- The `edges { node { ... } }` nesting is the **Relay connection pattern** — a GraphQL convention for paginated lists. You'll see it in GitHub's API and most big GraphQL schemas.
- **Errors don't use HTTP status codes.** GraphQL happily returns 200 with an `errors` array or a null `data`. That's why our parser treats "shape isn't what I expect" as `[]` rather than relying on status codes — and why `!res.ok` (real transport failure) is a separate, throwing case.

## Concept 3: Errors as types vs. errors as exceptions — drawing the line deliberately

The pipeline distinguishes two *kinds* of "no result", and the distinction is load-bearing for the whole architecture:

- **"RMP answered and there's no confident match"** → returns `{ status: "not_found" }`. This is a *successful lookup* with a negative answer. It's data. It gets cached (Task 5 caches it for 1 day), and the UI shows a gray "n/a" badge.
- **"I couldn't ask RMP"** (network down, HTTP 503) → **throws**. This is a *failed lookup* — we know nothing. Callers must not cache it, and the extension's fallback chain (Task 10) catches the throw and tries the next layer.

If we'd conflated these (e.g., returned `not_found` on a 503), a one-hour RMP outage would poison caches with false "this professor doesn't exist" entries for a day. The type system enforces the contract: `Promise<LookupResult>` for answers, exceptions for non-answers.

Also note `best.numRatings === 0 → not_found`: a professor *page* with zero ratings would render as "0.0 red badge" — worse than honest absence. Data-quality decisions like this belong at the boundary, in one place.

## Concept 4: Adapter functions

`teacherToRating` is a pure **adapter**: RMP's vocabulary (`avgRating`, `wouldTakeAgainPercent: -1`) in, our vocabulary (`rating`, `wouldTakeAgain: null`) out, plus derived fields (`rmpUrl` built from `legacyId`). Every external API integration should have exactly one of these; grep for where an external field name appears in your codebase, and if the answer is "more than one file," you're missing an adapter.

## The system so far

`packages/shared` is now a complete, tested, environment-agnostic "RMP SDK": constants → parse → match → client. It has zero dependencies on Chrome, Cloudflare, or the DOM — which is precisely why the next two consumers (Worker in Task 5, extension background in Task 10) can both import it unchanged. When you design your own systems, this is the shape to aim for: a pure core, thin platform shells around it.
