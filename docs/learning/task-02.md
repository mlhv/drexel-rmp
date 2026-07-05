# Learning notes — Task 2: The RMP response validator

## What we built

One pure function — `parseTeacherSearchResponse(json: unknown): RmpTeacher[]` — plus a JSON fixture of a real RMP API response, and tests. Small task, but it embodies three ideas you'll reuse in every system you ever build.

## Idea 1: Validate at the boundary, trust inside

Data arriving from the network is **untrusted input** — RMP could change their schema tomorrow, return an error page, or send `null` where we expect an object. The type signature tells the story:

```ts
function parseTeacherSearchResponse(json: unknown): RmpTeacher[]
```

`unknown` is TypeScript's "I know nothing about this" type — unlike `any`, you can't touch it without checking first. The function is the *border checkpoint*: garbage in → clean, guaranteed-valid `RmpTeacher[]` out (or `[]`). Every module downstream of this function gets to trust its data completely — no `if (teacher?.firstName)` defensive noise scattered through the codebase. Centralizing suspicion in one place is what keeps the rest of the code clean.

Why does TypeScript alone not save us? Because **TS types are erased at compile time** — they're promises between developers, not runtime checks. `await res.json()` returns whatever RMP actually sent, regardless of what type we *claim* it is. Runtime validation (`typeof n?.legacyId === "number"` etc.) is the only real protection. (Libraries like Zod industrialize this pattern; ours is small enough to hand-roll.)

## Idea 2: Never throw on bad input — degrade

The contract is "never throws; returns `[]` or valid teachers only, drops bad nodes, keeps good ones." That's a *policy* decision flowing from the spec: a broken RMP response must become "no badge shown," never "extension crashed." The tooling for this:

- **Optional chaining** `(json as any)?.data?.newSearch?.teachers?.edges` — each `?.` short-circuits to `undefined` instead of throwing `TypeError: cannot read property of undefined`. One expression safely probes four levels deep into hostile data.
- `Array.isArray(edges)` — because `typeof [] === "object"` and `typeof null === "object"` (a famous JS wart); `Array.isArray` is the reliable check.
- Per-node `typeof` guards, so one malformed node doesn't poison the valid ones next to it.

The reviewer flagged (correctly, as a Minor) that `as any` inside the function trades away some compiler help for brevity — the honest version of this tradeoff is: `any` is acceptable *inside* a validator whose entire job is runtime checking, and nowhere else.

## Idea 3: Fixtures — freeze reality into your tests

`fixtures/teacherSearchResponse.json` is the byte-for-byte response the real RMP API gave us. Tests run against *that*, not against data we imagined. Two payoffs:

1. If a test passes against a real captured response, the parser demonstrably handles reality, not our guess at reality.
2. If RMP changes their schema someday, we capture a new fixture, watch tests fail, and know exactly what changed — the fixture is a *contract snapshot*.

The same technique returns in Task 12 with captured Drexel HTML.

## The TDD rhythm (now visible in practice)

The implementer followed **RED → GREEN**: wrote the tests first, ran them, watched them fail with "module not found" (proving the tests actually execute and demand something), *then* wrote the implementation, then watched them pass. Why the ceremony? A test you've never seen fail is unverified — it might be accidentally testing nothing. RED is the proof the test has teeth.

## Small tooling note

The JSON import (`import fixture from "./fixtures/...json"`) required `"resolveJsonModule": true` in `tsconfig.base.json` — TS treats JSON as importable modules only when asked, and then it even *types* the JSON's shape from its literal contents.
