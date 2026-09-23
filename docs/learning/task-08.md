# Learning notes — Task 8: Turning messy page text into clean names

## What we built

`packages/extension/lib/names.ts`, two pure functions that sit between "text scraped off a Drexel page" and "name we look up on RMP":

```
normalizeInstructorName("Smith, John R.")        → "John Smith"
normalizeInstructorName("Dr. John Smith")        → "John Smith"
normalizeInstructorName("John Smith (Primary)")  → "John Smith"
normalizeInstructorName("STAFF")                 → null

parseInstructorCell("Smith, John; STAFF; Smith, John R")  → ["John Smith"]
```

26 tests, written first, watched fail ("module not found"), then made to pass.

## Concept 1: Why normalization is its own layer

Course pages say `Smith, John R`. RMP stores `John Smith`. The Worker's cache key is the lowercased name. If each of these spoke its own format, you'd get three bugs at once: RMP searches that miss, cache entries that never hit (`prof:smith, john r` vs `prof:john smith`), and duplicate lookups for the same person.

So there's one **canonical form**, "First Last", and a single function that converts into it at the edge of the system, right where untrusted text enters. Everything downstream (background worker, Worker cache, matcher) only ever sees canonical names. This "normalize at the boundary" pattern shows up everywhere: emails lowercased at signup, phone numbers converted to E.164, timestamps to UTC.

## Concept 2: Pure functions are the cheapest thing to test

`names.ts` has no imports, no DOM, no network, no `chrome.*`. Output depends only on input. That means:

- tests are a plain table of `[input, expected]` pairs (`it.each`), with no mocks, setup or teardown,
- the whole suite runs in ~3ms,
- when Task 12 finds a weird real-world name format, the fix is: add a row, watch it fail, adjust the function.

That's why the spec calls this "the primary unit-test surface". The design pushes the messy logic into a pure core, and leaves the DOM-touching code (scanner, badges) thin. Same shape as the Worker: `pickBestMatch` is pure; the Hono handler just wires it up.

## Concept 3: Returning `null` instead of guessing

`"STAFF"`, `"TBD"`, `","` and `"Smith, J"` all return `null`, meaning "not a person I can look up". The type `string | null` forces every caller to handle that case (TypeScript won't let you pass a maybe-null into something expecting `string`).

This mirrors the matcher's rule from Task 3: *never show a low-confidence result*. Looking up "Staff" on RMP could plausibly match a real professor named Staff and show a wrong rating, which is worse than showing nothing. Each layer refuses to guess rather than pass garbage downstream.

`parseInstructorCell` then uses a **type guard** to drop the nulls:

```ts
.filter((n): n is string => n !== null)
```

A plain `.filter(n => n !== null)` would still be typed `(string | null)[]`, because TypeScript can't infer the narrowing from an arbitrary callback. The `n is string` return annotation tells it "if this returns true, `n` is a string", so the result is `string[]`. Then `[...new Set(names)]` dedupes while keeping first-seen order.

## Concept 4: Probing beyond the tests found a spec gap

After the plan's tests passed, I fed in inputs the tests *didn't* cover. Two things showed up:

1. `"Dr. John Smith"` → `"Dr. John Smith"`. The spec says "strip middle initials/**titles**", but the plan's code only handled initials and suffixes. Fixed the TDD way: added three failing rows (`Dr. John Smith`, `Smith, Dr. John`, `Prof John Smith`), then a `TITLES` set filtered in `cleanTokens`.
2. `"Mary Anne Smith"` → `"Mary Anne Smith"`, but `"Smith, Mary Anne"` → `"Mary Smith"`. Without a comma, a middle name and a two-word last name ("Van Der Berg") look identical. There's no right answer in the abstract, only for the formats Drexel actually uses, so it's **deliberately left open** until Task 12 captures real page HTML. Logged in the progress ledger so it isn't forgotten.

Lesson: passing tests prove the cases you thought of. Spending two minutes on "what inputs would break this?" is how you find the ones you didn't, and comparing against the *spec* (not just the plan's code) is how you catch requirements that fell through the cracks between documents.
