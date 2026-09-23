# Drexel RMP Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome MV3 extension that injects Rate My Professors ratings next to instructor names on Drexel's Term Master Schedule and Banner registration pages, backed by a Cloudflare Worker KV cache with direct-to-RMP fallback.

**Architecture:** pnpm monorepo with three packages: `shared` (types, RMP GraphQL client, match scoring — consumed by both other packages), `worker` (Hono app on Cloudflare Workers with KV cache), `extension` (WXT-built MV3 extension: two content scripts, background service worker with 3-layer lookup: local storage cache → Worker → RMP direct).

**Tech Stack:** TypeScript (strict), pnpm workspaces, WXT ^0.20, Hono ^4, Wrangler ^4, Workers KV, Vitest ^3 (+ `@cloudflare/vitest-pool-workers` for worker, happy-dom + WXT's `WxtVitest` for extension), `@floating-ui/dom` for tooltip positioning.

**Spec:** `docs/superpowers/specs/2026-07-04-drexel-rmp-extension-design.md`

## Global Constraints

- TypeScript everywhere, `"strict": true`. No React or other UI framework — vanilla TS + Shadow DOM.
- Manifest V3 only. Extension permissions: `storage`. Host permissions: `https://*.drexel.edu/*`, `https://www.ratemyprofessors.com/*`, `https://*.workers.dev/*`, `http://localhost:8787/*`.
- **Verified RMP constants (tested live 2026-07-04, do not change):** endpoint `https://www.ratemyprofessors.com/graphql`; auth header `Authorization: Basic dGVzdDp0ZXN0`; Drexel school ID `U2Nob29sLTE1MjE=`.
- Cache TTLs: extension local cache fresh window 24h (stale entries still usable as last resort); Worker KV 7 days positive / 1 day negative.
- Worker timeout in extension: 3000 ms (`AbortSignal.timeout(3000)`).
- Match acceptance: score ≥ 0.8; ambiguity guard: reject if runner-up is within 0.05 and also ≥ 0.8. Never show a low-confidence match.
- Failures on the host page must be silent: no thrown errors escaping content scripts, no layout breakage.
- Commit messages have no `Co-Authored-By` trailer.
- Run tests with `pnpm -F <pkg> test` (vitest run mode, never watch mode).

---

### Task 1: Monorepo scaffold + shared package with types and constants

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/types.ts`, `packages/shared/src/constants.ts`
- Test: `packages/shared/src/constants.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: package `@drexel-rmp/shared` importable by later tasks; exports `ProfessorRating`, `RmpTeacher`, `LookupResult` types and `RMP_GRAPHQL_URL`, `RMP_AUTH_HEADER`, `DREXEL_SCHOOL_ID`, `TEACHER_SEARCH_QUERY` constants.

- [ ] **Step 1: Create workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`package.json` (root):
```json
{
  "name": "drexel-rmp",
  "private": true,
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`.gitignore`:
```
node_modules/
.output/
.wxt/
dist/
.wrangler/
.dev.vars
```

- [ ] **Step 2: Create shared package**

`packages/shared/package.json`:
```json
{
  "name": "@drexel-rmp/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "build": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```
(`main` points at TS source on purpose — every consumer bundles TS itself: WXT, Wrangler, Vitest.)

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/shared/src/types.ts`:
```ts
/** Raw teacher node from RMP's GraphQL teacher search. */
export interface RmpTeacher {
  id: string;
  legacyId: number;
  firstName: string;
  lastName: string;
  avgRating: number;
  avgDifficulty: number;
  numRatings: number;
  /** RMP uses -1 when unknown. */
  wouldTakeAgainPercent: number;
  department?: string;
}

/** Cleaned rating shape shown to users. The wire format between worker and extension. */
export interface ProfessorRating {
  /** RMP's canonical name, e.g. "Jeffrey Popyack". */
  name: string;
  rating: number;
  difficulty: number;
  /** Percent 0-100, or null when RMP has no data. */
  wouldTakeAgain: number | null;
  numRatings: number;
  legacyId: number;
  rmpUrl: string;
}

export type LookupResult =
  | { status: "found"; rating: ProfessorRating }
  | { status: "not_found" };
```

`packages/shared/src/constants.ts`:
```ts
export const RMP_GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql";
/** Public credential shipped by RMP's own frontend (base64 of "test:test"). Not a secret. */
export const RMP_AUTH_HEADER = "Basic dGVzdDp0ZXN0";
/** GraphQL node ID for Drexel University (School-1521). Verified live 2026-07-04. */
export const DREXEL_SCHOOL_ID = "U2Nob29sLTE1MjE=";
/** Legacy numeric ID, used in ratemyprofessors.com URLs. */
export const DREXEL_LEGACY_SCHOOL_ID = 1521;

export const TEACHER_SEARCH_QUERY = `
query TeacherSearch($query: TeacherSearchQuery!) {
  newSearch {
    teachers(query: $query) {
      edges {
        node {
          id
          legacyId
          firstName
          lastName
          avgRating
          avgDifficulty
          numRatings
          wouldTakeAgainPercent
          department
        }
      }
    }
  }
}`;
```

`packages/shared/src/index.ts`:
```ts
export * from "./types";
export * from "./constants";
```

- [ ] **Step 3: Write a smoke test**

`packages/shared/src/constants.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DREXEL_SCHOOL_ID, RMP_AUTH_HEADER, RMP_GRAPHQL_URL } from "./constants";

describe("constants", () => {
  it("exports the verified RMP constants", () => {
    expect(RMP_GRAPHQL_URL).toBe("https://www.ratemyprofessors.com/graphql");
    expect(atob(DREXEL_SCHOOL_ID)).toBe("School-1521");
    expect(atob(RMP_AUTH_HEADER.replace("Basic ", ""))).toBe("test:test");
  });
});
```

- [ ] **Step 4: Install and run tests**

Run: `pnpm install` then `pnpm -F @drexel-rmp/shared test`
Expected: 1 test file, 1 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with shared types package"
```

---

### Task 2: Shared — RMP response validator

**Files:**
- Create: `packages/shared/src/rmpParse.ts`
- Create: `packages/shared/src/fixtures/teacherSearchResponse.json`
- Modify: `packages/shared/src/index.ts` (add `export * from "./rmpParse";`)
- Test: `packages/shared/src/rmpParse.test.ts`

**Interfaces:**
- Consumes: `RmpTeacher` from Task 1.
- Produces: `parseTeacherSearchResponse(json: unknown): RmpTeacher[]` — returns `[]` or valid teachers only; never throws on malformed input.

- [ ] **Step 1: Commit the real API response as a fixture**

`packages/shared/src/fixtures/teacherSearchResponse.json` (captured live from RMP 2026-07-04):
```json
{
  "data": {
    "newSearch": {
      "teachers": {
        "edges": [
          {
            "node": {
              "avgDifficulty": 3.6,
              "avgRating": 2.3,
              "department": "Computer Science",
              "firstName": "Jeffrey",
              "id": "VGVhY2hlci01NjU5Mzc=",
              "lastName": "Popyack",
              "legacyId": 565937,
              "numRatings": 28,
              "wouldTakeAgainPercent": 42.8571
            }
          }
        ]
      }
    }
  }
}
```

- [ ] **Step 2: Write failing tests**

`packages/shared/src/rmpParse.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseTeacherSearchResponse } from "./rmpParse";
import fixture from "./fixtures/teacherSearchResponse.json";

describe("parseTeacherSearchResponse", () => {
  it("parses a real RMP response", () => {
    const teachers = parseTeacherSearchResponse(fixture);
    expect(teachers).toHaveLength(1);
    expect(teachers[0]).toMatchObject({
      firstName: "Jeffrey",
      lastName: "Popyack",
      legacyId: 565937,
      avgRating: 2.3,
      numRatings: 28,
    });
  });

  it("returns [] for malformed payloads instead of throwing", () => {
    for (const bad of [null, undefined, 42, "x", {}, { data: {} }, { data: { newSearch: { teachers: { edges: "nope" } } } }]) {
      expect(parseTeacherSearchResponse(bad)).toEqual([]);
    }
  });

  it("drops nodes missing required fields but keeps valid ones", () => {
    const mixed = {
      data: { newSearch: { teachers: { edges: [
        { node: { firstName: "Jane" } },
        (fixture as any).data.newSearch.teachers.edges[0],
      ] } } },
    };
    expect(parseTeacherSearchResponse(mixed)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm -F @drexel-rmp/shared test`
Expected: FAIL — `rmpParse` module not found. (Add `"resolveJsonModule": true` to `tsconfig.base.json` compilerOptions if TS complains about the JSON import.)

- [ ] **Step 4: Implement**

`packages/shared/src/rmpParse.ts`:
```ts
import type { RmpTeacher } from "./types";

/** Defensively extract valid teacher nodes from an RMP GraphQL response. Never throws. */
export function parseTeacherSearchResponse(json: unknown): RmpTeacher[] {
  const edges = (json as any)?.data?.newSearch?.teachers?.edges;
  if (!Array.isArray(edges)) return [];
  const teachers: RmpTeacher[] = [];
  for (const edge of edges) {
    const n = edge?.node;
    if (
      typeof n?.id === "string" &&
      typeof n?.legacyId === "number" &&
      typeof n?.firstName === "string" &&
      typeof n?.lastName === "string" &&
      typeof n?.avgRating === "number" &&
      typeof n?.avgDifficulty === "number" &&
      typeof n?.numRatings === "number" &&
      typeof n?.wouldTakeAgainPercent === "number"
    ) {
      teachers.push({
        id: n.id,
        legacyId: n.legacyId,
        firstName: n.firstName,
        lastName: n.lastName,
        avgRating: n.avgRating,
        avgDifficulty: n.avgDifficulty,
        numRatings: n.numRatings,
        wouldTakeAgainPercent: n.wouldTakeAgainPercent,
        department: typeof n.department === "string" ? n.department : undefined,
      });
    }
  }
  return teachers;
}
```
Also add `export * from "./rmpParse";` to `packages/shared/src/index.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @drexel-rmp/shared test`
Expected: PASS (all files).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shared): RMP teacher search response validator with live fixture"
```

---

### Task 3: Shared — match scoring

**Files:**
- Create: `packages/shared/src/match.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./match";`)
- Test: `packages/shared/src/match.test.ts`

**Interfaces:**
- Consumes: `RmpTeacher` from Task 1.
- Produces: `pickBestMatch(query: string, candidates: RmpTeacher[]): RmpTeacher | null` where `query` is a normalized `"First Last"` string. Also exports `similarity(a: string, b: string): number` (0–1).

- [ ] **Step 1: Write failing tests**

`packages/shared/src/match.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { pickBestMatch, similarity } from "./match";
import type { RmpTeacher } from "./types";

function teacher(firstName: string, lastName: string, over: Partial<RmpTeacher> = {}): RmpTeacher {
  return {
    id: "x", legacyId: 1, firstName, lastName,
    avgRating: 4, avgDifficulty: 3, numRatings: 10, wouldTakeAgainPercent: 80,
    ...over,
  };
}

describe("similarity", () => {
  it("is 1 for identical strings and 0 for disjoint ones", () => {
    expect(similarity("smith", "smith")).toBe(1);
    expect(similarity("smith", "xyzqw")).toBeLessThan(0.3);
  });
});

describe("pickBestMatch", () => {
  it("matches an exact name", () => {
    const t = teacher("Jeffrey", "Popyack");
    expect(pickBestMatch("Jeffrey Popyack", [t])).toBe(t);
  });

  it("matches nickname/prefix first names (Jeff ~ Jeffrey)", () => {
    const t = teacher("Jeffrey", "Popyack");
    expect(pickBestMatch("Jeff Popyack", [t])).toBe(t);
  });

  it("is case-insensitive and punctuation-insensitive", () => {
    const t = teacher("Mary-Anne", "O'Brien");
    expect(pickBestMatch("mary anne obrien", [t])).toBe(t);
  });

  it("rejects a different professor even with same first name", () => {
    expect(pickBestMatch("John Smith", [teacher("John", "Smythe-Kowalski")])).toBeNull();
  });

  it("rejects when two candidates are ambiguously close", () => {
    const a = teacher("John", "Smith");
    const b = teacher("Jon", "Smith");
    expect(pickBestMatch("J Smith", [a, b])).toBeNull();
  });

  it("picks the clearly better of two candidates", () => {
    const right = teacher("John", "Smith");
    const wrong = teacher("Jane", "Smithers");
    expect(pickBestMatch("John Smith", [wrong, right])).toBe(right);
  });

  it("returns null for empty candidate list", () => {
    expect(pickBestMatch("John Smith", [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @drexel-rmp/shared test`
Expected: FAIL — `match` module not found.

- [ ] **Step 3: Implement**

`packages/shared/src/match.ts`:
```ts
import type { RmpTeacher } from "./types";

const ACCEPT_THRESHOLD = 0.8;
const AMBIGUITY_GAP = 0.05;

function clean(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n]!;
}

/** 0–1 string similarity based on Levenshtein distance. */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const max = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / max;
}

function isPrefixMatch(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

function nameScore(query: string, candidate: string): number {
  const qTokens = query.split(" ");
  const cTokens = candidate.split(" ");
  const qFirst = qTokens[0] ?? "";
  const cFirst = cTokens[0] ?? "";
  const qLast = qTokens.slice(1).join(" ") || qFirst;
  const cLast = cTokens.slice(1).join(" ") || cFirst;
  // Also compare with candidate last-name spaces removed ("mary anne obrien" vs "o brien").
  const lastSim = Math.max(
    similarity(qLast, cLast),
    similarity(qLast.replace(/\s/g, ""), cLast.replace(/\s/g, "")),
  );
  const firstSim = isPrefixMatch(qFirst, cFirst) ? 1 : similarity(qFirst, cFirst);
  const tokenScore = 0.6 * lastSim + 0.4 * firstSim;
  // Whole-name fallback (spaces removed) rescues hyphen/spacing variants like
  // "mary anne obrien" vs "Mary-Anne O'Brien" that token splitting mis-segments.
  const wholeScore = similarity(query.replace(/\s/g, ""), candidate.replace(/\s/g, ""));
  return Math.max(tokenScore, wholeScore);
}

/**
 * Pick the candidate matching a normalized "First Last" query.
 * Returns null rather than guess: below-threshold or ambiguous → no match.
 */
export function pickBestMatch(query: string, candidates: RmpTeacher[]): RmpTeacher | null {
  const q = clean(query);
  if (!q) return null;
  const scored = candidates
    .map((c) => ({ c, score: nameScore(q, clean(`${c.firstName} ${c.lastName}`)) }))
    .sort((x, y) => y.score - x.score);
  const best = scored[0];
  if (!best || best.score < ACCEPT_THRESHOLD) return null;
  const second = scored[1];
  if (second && second.score >= ACCEPT_THRESHOLD && best.score - second.score < AMBIGUITY_GAP) {
    return null; // two plausible matches — refuse to guess
  }
  return best.c;
}
```
Also add `export * from "./match";` to `packages/shared/src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @drexel-rmp/shared test`
Expected: PASS. If a specific case fails, adjust weights/threshold only with all tests green — the test cases are the contract.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): confidence-scored professor name matching"
```

---

### Task 4: Shared — RMP client (search + lookup)

**Files:**
- Create: `packages/shared/src/rmpClient.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./rmpClient";`)
- Test: `packages/shared/src/rmpClient.test.ts`

**Interfaces:**
- Consumes: constants (Task 1), `parseTeacherSearchResponse` (Task 2), `pickBestMatch` (Task 3).
- Produces:
  - `searchRmpTeachers(name: string, fetchFn?: typeof fetch): Promise<RmpTeacher[]>` — throws on HTTP/network error.
  - `lookupProfessorViaRmp(name: string, fetchFn?: typeof fetch): Promise<LookupResult>` — throws on HTTP/network error; `not_found` for no/low-confidence/zero-rating match.
  - `teacherToRating(t: RmpTeacher): ProfessorRating`.

- [ ] **Step 1: Write failing tests**

`packages/shared/src/rmpClient.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { lookupProfessorViaRmp, searchRmpTeachers, teacherToRating } from "./rmpClient";
import { DREXEL_SCHOOL_ID, RMP_AUTH_HEADER, RMP_GRAPHQL_URL } from "./constants";
import fixture from "./fixtures/teacherSearchResponse.json";

const okFetch = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("searchRmpTeachers", () => {
  it("POSTs the query with auth header and school scope", async () => {
    const fetchFn = okFetch(fixture);
    const teachers = await searchRmpTeachers("Jeffrey Popyack", fetchFn);
    expect(teachers).toHaveLength(1);
    const [url, init] = (fetchFn as any).mock.calls[0];
    expect(url).toBe(RMP_GRAPHQL_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(RMP_AUTH_HEADER);
    const body = JSON.parse(init.body);
    expect(body.variables.query).toEqual({ text: "Jeffrey Popyack", schoolID: DREXEL_SCHOOL_ID });
  });

  it("throws on non-200", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(searchRmpTeachers("X", fetchFn)).rejects.toThrow(/503/);
  });
});

describe("lookupProfessorViaRmp", () => {
  it("returns found with mapped rating for a confident match", async () => {
    const result = await lookupProfessorViaRmp("Jeffrey Popyack", okFetch(fixture));
    expect(result).toEqual({
      status: "found",
      rating: {
        name: "Jeffrey Popyack",
        rating: 2.3,
        difficulty: 3.6,
        wouldTakeAgain: 43,
        numRatings: 28,
        legacyId: 565937,
        rmpUrl: "https://www.ratemyprofessors.com/professor/565937",
      },
    });
  });

  it("returns not_found when no candidate matches", async () => {
    const result = await lookupProfessorViaRmp("Zzyzx Nobody", okFetch(fixture));
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns not_found for a match with zero ratings", async () => {
    const zero = JSON.parse(JSON.stringify(fixture));
    zero.data.newSearch.teachers.edges[0].node.numRatings = 0;
    const result = await lookupProfessorViaRmp("Jeffrey Popyack", okFetch(zero));
    expect(result).toEqual({ status: "not_found" });
  });
});

describe("teacherToRating", () => {
  it("maps wouldTakeAgainPercent -1 to null", () => {
    const t = { ...((fixture as any).data.newSearch.teachers.edges[0].node), wouldTakeAgainPercent: -1 };
    expect(teacherToRating(t).wouldTakeAgain).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @drexel-rmp/shared test`
Expected: FAIL — `rmpClient` module not found.

- [ ] **Step 3: Implement**

`packages/shared/src/rmpClient.ts`:
```ts
import { DREXEL_SCHOOL_ID, RMP_AUTH_HEADER, RMP_GRAPHQL_URL, TEACHER_SEARCH_QUERY } from "./constants";
import { pickBestMatch } from "./match";
import { parseTeacherSearchResponse } from "./rmpParse";
import type { LookupResult, ProfessorRating, RmpTeacher } from "./types";

export async function searchRmpTeachers(name: string, fetchFn: typeof fetch = fetch): Promise<RmpTeacher[]> {
  const res = await fetchFn(RMP_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: RMP_AUTH_HEADER,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: TEACHER_SEARCH_QUERY,
      variables: { query: { text: name, schoolID: DREXEL_SCHOOL_ID } },
    }),
  });
  if (!res.ok) throw new Error(`RMP GraphQL HTTP ${res.status}`);
  return parseTeacherSearchResponse(await res.json());
}

export function teacherToRating(t: RmpTeacher): ProfessorRating {
  return {
    name: `${t.firstName} ${t.lastName}`,
    rating: t.avgRating,
    difficulty: t.avgDifficulty,
    wouldTakeAgain: t.wouldTakeAgainPercent >= 0 ? Math.round(t.wouldTakeAgainPercent) : null,
    numRatings: t.numRatings,
    legacyId: t.legacyId,
    rmpUrl: `https://www.ratemyprofessors.com/professor/${t.legacyId}`,
  };
}

/** Search + match + map. Throws on network/HTTP failure so callers can fall back. */
export async function lookupProfessorViaRmp(name: string, fetchFn: typeof fetch = fetch): Promise<LookupResult> {
  const teachers = await searchRmpTeachers(name, fetchFn);
  const best = pickBestMatch(name, teachers);
  if (!best || best.numRatings === 0) return { status: "not_found" };
  return { status: "found", rating: teacherToRating(best) };
}
```
Also add `export * from "./rmpClient";` to `packages/shared/src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @drexel-rmp/shared test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): RMP GraphQL client with lookup pipeline"
```

---

### Task 5: Worker — Hono app with KV cache

**Files:**
- Create: `packages/worker/package.json`, `packages/worker/tsconfig.json`, `packages/worker/wrangler.toml`, `packages/worker/src/index.ts`, `packages/worker/test/env.d.ts`, `packages/worker/vitest.config.ts`
- Test: `packages/worker/test/prof.test.ts`

**Interfaces:**
- Consumes: `lookupProfessorViaRmp`, `LookupResult` from `@drexel-rmp/shared`.
- Produces: HTTP API `GET /prof?name=<normalized "First Last">` → 200 with `LookupResult` JSON; 400 `{"error":"name required"}` if missing; 502 `{"error":"rmp_unavailable"}` if RMP fails on a cache miss. This is the wire contract the extension's `fetchFromWorker` (Task 10) relies on.

- [ ] **Step 1: Scaffold the package**

`packages/worker/package.json`:
```json
{
  "name": "@drexel-rmp/worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "build": "tsc --noEmit"
  },
  "dependencies": {
    "@drexel-rmp/shared": "workspace:*",
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20250101.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.0.0"
  }
}
```

`packages/worker/wrangler.toml` (the KV `id` is a dummy; local dev/tests use Miniflare's in-memory KV. Task 6 replaces it with the real namespace ID):
```toml
name = "drexel-rmp-worker"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "RMP_CACHE"
id = "00000000000000000000000000000000"
```

`packages/worker/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src", "test"]
}
```

`packages/worker/vitest.config.ts`:
```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: { wrangler: { configPath: "./wrangler.toml" } },
    },
  },
});
```

`packages/worker/test/env.d.ts`:
```ts
declare module "cloudflare:test" {
  interface ProvidedEnv {
    RMP_CACHE: KVNamespace;
  }
}
```

- [ ] **Step 2: Write failing tests**

`packages/worker/test/prof.test.ts`:
```ts
import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";
import fixture from "../../shared/src/fixtures/teacherSearchResponse.json";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

function mockRmp(body: unknown, status = 200) {
  fetchMock
    .get("https://www.ratemyprofessors.com")
    .intercept({ method: "POST", path: "/graphql" })
    .reply(status, JSON.stringify(body));
}

const req = (name?: string) =>
  new Request(`https://worker.test/prof${name ? `?name=${encodeURIComponent(name)}` : ""}`);

describe("GET /prof", () => {
  it("400s without a name", async () => {
    const res = await app.fetch(req(), env);
    expect(res.status).toBe(400);
  });

  it("cache miss: queries RMP, returns found, and stores in KV", async () => {
    mockRmp(fixture);
    const res = await app.fetch(req("Jeffrey Popyack"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("found");
    expect(body.rating.legacyId).toBe(565937);
    const stored = await env.RMP_CACHE.get("prof:jeffrey popyack", "json");
    expect((stored as any).status).toBe("found");
  });

  it("cache hit: serves from KV without calling RMP", async () => {
    await env.RMP_CACHE.put("prof:cached prof", JSON.stringify({ status: "not_found" }));
    const res = await app.fetch(req("Cached Prof"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "not_found" });
    // no mockRmp registered — assertNoPendingInterceptors would fail if RMP were called
  });

  it("502s when RMP is down on a cache miss", async () => {
    mockRmp({ error: "down" }, 503);
    const res = await app.fetch(req("Someone New"), env);
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 3: Install and run tests to verify they fail**

Run: `pnpm install` then `pnpm -F @drexel-rmp/worker test`
Expected: FAIL — `src/index` has no default export yet (file doesn't exist).

- [ ] **Step 4: Implement the Worker**

`packages/worker/src/index.ts`:
```ts
import { lookupProfessorViaRmp } from "@drexel-rmp/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = { Bindings: { RMP_CACHE: KVNamespace } };

const POSITIVE_TTL_SECONDS = 7 * 24 * 60 * 60; // found: 7 days
const NEGATIVE_TTL_SECONDS = 24 * 60 * 60; // not_found: 1 day

const app = new Hono<Env>();
app.use("*", cors()); // ratings are public data; tighten to the extension origin post-publish

app.get("/prof", async (c) => {
  const name = c.req.query("name")?.trim().toLowerCase();
  if (!name) return c.json({ error: "name required" }, 400);

  const key = `prof:${name}`;
  const cached = await c.env.RMP_CACHE.get(key, "json");
  if (cached) return c.json(cached);

  try {
    const result = await lookupProfessorViaRmp(name);
    await c.env.RMP_CACHE.put(key, JSON.stringify(result), {
      expirationTtl: result.status === "found" ? POSITIVE_TTL_SECONDS : NEGATIVE_TTL_SECONDS,
    });
    return c.json(result);
  } catch {
    return c.json({ error: "rmp_unavailable" }, 502);
  }
});

export default app;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @drexel-rmp/worker test`
Expected: PASS (4 tests).

- [ ] **Step 6: Smoke-test against the real RMP API locally**

Run: `pnpm -F @drexel-rmp/worker dev` (in background), then:
`curl 'http://localhost:8787/prof?name=jeffrey%20popyack'`
Expected: `{"status":"found","rating":{...,"legacyId":565937,...}}`. Then Ctrl-C the dev server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(worker): /prof endpoint with KV cache over RMP lookup"
```

---

### Task 6: Worker — deploy to Cloudflare (user-assisted)

**Files:**
- Modify: `packages/worker/wrangler.toml` (real KV namespace id)
- Create: `packages/worker/README.md`

**Interfaces:**
- Consumes: Task 5's worker.
- Produces: a live `https://drexel-rmp-worker.<account>.workers.dev` URL, recorded in `packages/worker/README.md` — Task 10 pastes it into the extension's `WORKER_URL`.

- [ ] **Step 1: PAUSE — ask your human partner to authenticate**

Cloudflare login is interactive. Ask the user to run: `cd packages/worker && npx wrangler login` (a free Cloudflare account is sufficient). Do not proceed until they confirm.

- [ ] **Step 2: Create the KV namespace**

Run: `pnpm -F @drexel-rmp/worker exec wrangler kv namespace create RMP_CACHE`
Expected output contains `id = "<32-hex-chars>"`. Replace the dummy `id` in `wrangler.toml`'s `[[kv_namespaces]]` block with it.

- [ ] **Step 3: Deploy**

Run: `pnpm -F @drexel-rmp/worker deploy`
Expected: `Deployed drexel-rmp-worker ... https://drexel-rmp-worker.<subdomain>.workers.dev`

- [ ] **Step 4: Verify live**

Run: `curl 'https://drexel-rmp-worker.<subdomain>.workers.dev/prof?name=jeffrey%20popyack'`
Expected: `{"status":"found",...}`. Run it twice — the second call is a KV hit (visibly faster).

- [ ] **Step 5: Record the URL and commit**

`packages/worker/README.md`:
```markdown
# drexel-rmp-worker

Cache proxy for RMP lookups. Deployed at:

    https://drexel-rmp-worker.<subdomain>.workers.dev   <- replace with actual URL from step 3

- `GET /prof?name=<first last>` → `LookupResult` JSON (see @drexel-rmp/shared)
- KV: `RMP_CACHE`, keys `prof:<lowercased name>`, TTL 7d found / 1d not_found
- Deploy: `pnpm -F @drexel-rmp/worker deploy` (requires `wrangler login`)
```

```bash
git add -A
git commit -m "chore(worker): deploy to Cloudflare, record live URL and KV namespace"
```

---

### Task 7: Extension — WXT scaffold + manifest

**Files:**
- Create: `packages/extension/package.json`, `packages/extension/tsconfig.json`, `packages/extension/wxt.config.ts`, `packages/extension/vitest.config.ts`, `packages/extension/entrypoints/background.ts`

**Interfaces:**
- Consumes: nothing yet (scaffold).
- Produces: a building WXT project; `pnpm -F @drexel-rmp/extension build` outputs `.output/chrome-mv3/manifest.json` with the permissions/host_permissions listed in Global Constraints. Later tasks add files under `packages/extension/lib/`, `components/`, `entrypoints/`.

- [ ] **Step 1: Scaffold the package**

`packages/extension/package.json`:
```json
{
  "name": "@drexel-rmp/extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "test": "vitest run",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "@drexel-rmp/shared": "workspace:*",
    "@floating-ui/dom": "^1.6.0"
  },
  "devDependencies": {
    "happy-dom": "^17.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0",
    "wxt": "^0.20.0"
  }
}
```

`packages/extension/wxt.config.ts`:
```ts
import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Drexel RMP Ratings",
    description: "Rate My Professors ratings inline on Drexel course pages.",
    permissions: ["storage"],
    host_permissions: [
      "https://*.drexel.edu/*",
      "https://www.ratemyprofessors.com/*",
      "https://*.workers.dev/*",
      "http://localhost:8787/*",
    ],
  },
});
```

`packages/extension/tsconfig.json`:
```json
{
  "extends": "./.wxt/tsconfig.json"
}
```
(WXT generates `.wxt/tsconfig.json` with its path aliases during `wxt prepare`.)

`packages/extension/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

export default defineConfig({
  plugins: [WxtVitest()],
  test: { environment: "happy-dom" },
});
```

`packages/extension/entrypoints/background.ts` (minimal for now; Task 10 replaces it):
```ts
export default defineBackground(() => {
  console.log("[drexel-rmp] background service worker started");
});
```
(`defineBackground` is a WXT auto-import — no import statement needed.)

- [ ] **Step 2: Install and build**

Run: `pnpm install` then `pnpm -F @drexel-rmp/extension build`
Expected: build succeeds; `.output/chrome-mv3/manifest.json` exists.

- [ ] **Step 3: Verify the generated manifest**

Run: `cat packages/extension/.output/chrome-mv3/manifest.json`
Expected: `"manifest_version": 3`, `"permissions": ["storage"]`, and all four `host_permissions` entries from Global Constraints.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(extension): WXT scaffold with MV3 manifest config"
```

---

### Task 8: Extension — instructor name normalization

**Files:**
- Create: `packages/extension/lib/names.ts`
- Test: `packages/extension/lib/names.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces:
  - `normalizeInstructorName(raw: string): string | null` — `"Smith, John R"` → `"John Smith"`; null for STAFF/TBD/unparseable.
  - `parseInstructorCell(text: string): string[]` — splits multi-instructor cells on `;`, normalizes each, drops nulls, dedupes.

- [ ] **Step 1: Write failing tests**

`packages/extension/lib/names.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { normalizeInstructorName, parseInstructorCell } from "./names";

describe("normalizeInstructorName", () => {
  it.each([
    ["Smith, John", "John Smith"],
    ["Smith, John R", "John Smith"],       // middle initial dropped
    ["Smith, John R.", "John Smith"],
    ["Popyack, Jeffrey L", "Jeffrey Popyack"],
    ["John Smith", "John Smith"],          // already First Last
    ["John R. Smith", "John Smith"],
    ["Garcia-Lopez, Maria", "Maria Garcia-Lopez"],  // hyphens kept
    ["O'Brien, Mary", "Mary O'Brien"],     // apostrophes kept
    ["Smith, John, Jr.", "John Smith"],    // suffix dropped
    ["John Smith (Primary)", "John Smith"], // Banner's primary marker
    ["Van Der Berg, Hans", "Hans Van Der Berg"], // multi-word last name
  ])("%s -> %s", (input, expected) => {
    expect(normalizeInstructorName(input)).toBe(expected);
  });

  it.each(["STAFF", "staff", "TBD", "TBA", "Instructor", "", "   ", ","])(
    "rejects non-name %j",
    (input) => expect(normalizeInstructorName(input)).toBeNull(),
  );
});

describe("parseInstructorCell", () => {
  it("splits multi-instructor cells on semicolons", () => {
    expect(parseInstructorCell("Smith, John; Doe, Jane")).toEqual(["John Smith", "Jane Doe"]);
  });
  it("drops STAFF entries but keeps real ones", () => {
    expect(parseInstructorCell("STAFF; Doe, Jane")).toEqual(["Jane Doe"]);
  });
  it("dedupes repeated names", () => {
    expect(parseInstructorCell("Smith, John; Smith, John R")).toEqual(["John Smith"]);
  });
  it("returns [] for empty/junk cells", () => {
    expect(parseInstructorCell("  ")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @drexel-rmp/extension test`
Expected: FAIL — `names` module not found.

- [ ] **Step 3: Implement**

`packages/extension/lib/names.ts`:
```ts
const NON_NAMES = new Set(["staff", "tba", "tbd", "instructor", "unassigned"]);
const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

const isInitial = (token: string) => /^[a-z]\.?$/i.test(token);
const isSuffix = (token: string) => SUFFIXES.has(token.toLowerCase());

function cleanTokens(part: string): string[] {
  return part
    .split(/\s+/)
    .filter((t) => t.length > 0 && !isInitial(t) && !isSuffix(t));
}

/** "Smith, John R" | "John R. Smith" -> "John Smith"; null for STAFF/TBD/unparseable. */
export function normalizeInstructorName(raw: string): string | null {
  const text = raw.replace(/\(.*?\)/g, "").trim(); // strip "(Primary)" etc.
  if (!text || NON_NAMES.has(text.toLowerCase())) return null;

  let firstPart: string;
  let lastPart: string;
  if (text.includes(",")) {
    // "Last, First [M] [, Suffix]"
    const segments = text.split(",").map((s) => s.trim()).filter(Boolean);
    if (segments.length < 2) return null;
    lastPart = segments[0]!;
    firstPart = segments[1]!; // segment 3+ is a suffix like "Jr." — dropped
  } else {
    // "First [M] Last..." — first token is the first name, rest is the last name
    const tokens = cleanTokens(text);
    if (tokens.length < 2) return null;
    firstPart = tokens[0]!;
    lastPart = tokens.slice(1).join(" ");
  }

  const first = cleanTokens(firstPart)[0];
  const last = cleanTokens(lastPart).join(" ");
  if (!first || !last) return null;
  return `${first} ${last}`;
}

/** Split a multi-instructor cell ("A; B"), normalize each, drop non-names, dedupe. */
export function parseInstructorCell(text: string): string[] {
  const names = text
    .split(";")
    .map(normalizeInstructorName)
    .filter((n): n is string => n !== null);
  return [...new Set(names)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @drexel-rmp/extension test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(extension): instructor name normalization"
```

---

### Task 9: Extension — local storage cache

**Files:**
- Create: `packages/extension/lib/cache.ts`
- Test: `packages/extension/lib/cache.test.ts`

**Interfaces:**
- Consumes: `LookupResult` from shared; `browser.storage.local` (faked in tests by WxtVitest's `fakeBrowser`).
- Produces:
  - `getCached(name: string): Promise<{ result: LookupResult; fresh: boolean } | null>`
  - `setCached(name: string, result: LookupResult): Promise<void>`
  - Keys are `rmp:<lowercased name>`; fresh = stored within 24h.

- [ ] **Step 1: Write failing tests**

`packages/extension/lib/cache.test.ts`:
```ts
import type { LookupResult } from "@drexel-rmp/shared";
import { fakeBrowser } from "wxt/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCached, setCached } from "./cache";

const FOUND: LookupResult = {
  status: "found",
  rating: {
    name: "Jeffrey Popyack", rating: 2.3, difficulty: 3.6, wouldTakeAgain: 43,
    numRatings: 28, legacyId: 565937,
    rmpUrl: "https://www.ratemyprofessors.com/professor/565937",
  },
};

afterEach(() => {
  fakeBrowser.reset();
  vi.useRealTimers();
});

describe("cache", () => {
  it("returns null on a miss", async () => {
    expect(await getCached("Nobody Here")).toBeNull();
  });

  it("round-trips a result as fresh, case-insensitively", async () => {
    await setCached("Jeffrey Popyack", FOUND);
    const hit = await getCached("jeffrey popyack");
    expect(hit).toEqual({ result: FOUND, fresh: true });
  });

  it("marks entries older than 24h as stale but still returns them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    await setCached("Jeffrey Popyack", FOUND);
    vi.setSystemTime(new Date("2026-07-02T00:00:01Z")); // 24h + 1s later
    const hit = await getCached("Jeffrey Popyack");
    expect(hit).toEqual({ result: FOUND, fresh: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @drexel-rmp/extension test`
Expected: FAIL — `cache` module not found.

- [ ] **Step 3: Implement**

`packages/extension/lib/cache.ts`:
```ts
import type { LookupResult } from "@drexel-rmp/shared";
import { browser } from "wxt/browser";

const FRESH_MS = 24 * 60 * 60 * 1000;

interface StoredEntry {
  result: LookupResult;
  storedAt: number;
}

const cacheKey = (name: string) => `rmp:${name.toLowerCase()}`;

export async function getCached(
  name: string,
): Promise<{ result: LookupResult; fresh: boolean } | null> {
  const key = cacheKey(name);
  const stored = await browser.storage.local.get(key);
  const entry = stored[key] as StoredEntry | undefined;
  if (!entry) return null;
  return { result: entry.result, fresh: Date.now() - entry.storedAt < FRESH_MS };
}

export async function setCached(name: string, result: LookupResult): Promise<void> {
  const entry: StoredEntry = { result, storedAt: Date.now() };
  await browser.storage.local.set({ [cacheKey(name)]: entry });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @drexel-rmp/extension test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(extension): 24h local storage cache for lookup results"
```

---

### Task 10: Extension — lookup orchestrator + background service worker

**Files:**
- Create: `packages/extension/lib/lookup.ts`, `packages/extension/lib/config.ts`
- Modify: `packages/extension/entrypoints/background.ts` (replace stub)
- Test: `packages/extension/lib/lookup.test.ts`

**Interfaces:**
- Consumes: `getCached`/`setCached` (Task 9), `lookupProfessorViaRmp` (Task 4), Worker wire contract (Task 5), Worker URL (Task 6).
- Produces:
  - `createLookupService(deps: LookupDeps): { lookup(name: string): Promise<LookupResult | null> }` — `null` means "all sources failed and nothing cached" (content script shows no badge).
  - Message protocol consumed by content scripts (Task 12/13): send `{ type: "LOOKUP_PROFESSOR", name: string }` via `browser.runtime.sendMessage`, receive `LookupResult | null`.
  - `WORKER_URL` constant in `lib/config.ts`.

- [ ] **Step 1: Write failing tests**

`packages/extension/lib/lookup.test.ts`:
```ts
import type { LookupResult } from "@drexel-rmp/shared";
import { describe, expect, it, vi } from "vitest";
import { createLookupService, type LookupDeps } from "./lookup";

const FOUND: LookupResult = {
  status: "found",
  rating: {
    name: "A B", rating: 4, difficulty: 2, wouldTakeAgain: 90, numRatings: 5,
    legacyId: 1, rmpUrl: "https://www.ratemyprofessors.com/professor/1",
  },
};
const NOT_FOUND: LookupResult = { status: "not_found" };

function makeDeps(over: Partial<LookupDeps> = {}): LookupDeps {
  return {
    getCached: vi.fn(async () => null),
    setCached: vi.fn(async () => {}),
    fetchFromWorker: vi.fn(async () => FOUND),
    fetchDirect: vi.fn(async () => NOT_FOUND),
    ...over,
  };
}

describe("createLookupService", () => {
  it("returns fresh cache without any network call", async () => {
    const deps = makeDeps({ getCached: vi.fn(async () => ({ result: FOUND, fresh: true })) });
    expect(await createLookupService(deps).lookup("A B")).toEqual(FOUND);
    expect(deps.fetchFromWorker).not.toHaveBeenCalled();
    expect(deps.fetchDirect).not.toHaveBeenCalled();
  });

  it("uses the worker on cache miss and stores the result", async () => {
    const deps = makeDeps();
    expect(await createLookupService(deps).lookup("A B")).toEqual(FOUND);
    expect(deps.setCached).toHaveBeenCalledWith("A B", FOUND);
    expect(deps.fetchDirect).not.toHaveBeenCalled();
  });

  it("falls back to direct RMP when the worker throws", async () => {
    const deps = makeDeps({ fetchFromWorker: vi.fn(async () => { throw new Error("timeout"); }) });
    expect(await createLookupService(deps).lookup("A B")).toEqual(NOT_FOUND);
    expect(deps.fetchDirect).toHaveBeenCalled();
  });

  it("serves stale cache when both network paths fail", async () => {
    const deps = makeDeps({
      getCached: vi.fn(async () => ({ result: FOUND, fresh: false })),
      fetchFromWorker: vi.fn(async () => { throw new Error("down"); }),
      fetchDirect: vi.fn(async () => { throw new Error("down"); }),
    });
    expect(await createLookupService(deps).lookup("A B")).toEqual(FOUND);
  });

  it("returns null when everything fails and nothing is cached", async () => {
    const deps = makeDeps({
      fetchFromWorker: vi.fn(async () => { throw new Error("down"); }),
      fetchDirect: vi.fn(async () => { throw new Error("down"); }),
    });
    expect(await createLookupService(deps).lookup("A B")).toBeNull();
  });

  it("dedupes concurrent lookups for the same name (case-insensitive)", async () => {
    let resolveWorker!: (r: LookupResult) => void;
    const deps = makeDeps({
      fetchFromWorker: vi.fn(() => new Promise<LookupResult>((res) => { resolveWorker = res; })),
    });
    const svc = createLookupService(deps);
    const [p1, p2] = [svc.lookup("A B"), svc.lookup("a b")];
    resolveWorker(FOUND);
    expect(await p1).toEqual(FOUND);
    expect(await p2).toEqual(FOUND);
    expect(deps.fetchFromWorker).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @drexel-rmp/extension test`
Expected: FAIL — `lookup` module not found.

- [ ] **Step 3: Implement the orchestrator**

`packages/extension/lib/lookup.ts`:
```ts
import type { LookupResult } from "@drexel-rmp/shared";

export interface LookupDeps {
  getCached(name: string): Promise<{ result: LookupResult; fresh: boolean } | null>;
  setCached(name: string, result: LookupResult): Promise<void>;
  /** Throws on failure/timeout. */
  fetchFromWorker(name: string): Promise<LookupResult>;
  /** Throws on failure. */
  fetchDirect(name: string): Promise<LookupResult>;
}

/**
 * 3-layer lookup: fresh local cache -> worker -> RMP direct -> stale cache -> null.
 * Concurrent lookups for the same name share one in-flight promise.
 */
export function createLookupService(deps: LookupDeps) {
  const inflight = new Map<string, Promise<LookupResult | null>>();

  async function doLookup(name: string): Promise<LookupResult | null> {
    const cached = await deps.getCached(name);
    if (cached?.fresh) return cached.result;

    for (const fetcher of [deps.fetchFromWorker, deps.fetchDirect]) {
      try {
        const result = await fetcher(name);
        await deps.setCached(name, result);
        return result;
      } catch {
        // fall through to next layer
      }
    }
    return cached?.result ?? null; // stale beats nothing; null = truly unavailable
  }

  return {
    lookup(name: string): Promise<LookupResult | null> {
      const key = name.toLowerCase();
      let pending = inflight.get(key);
      if (!pending) {
        pending = doLookup(name).finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      return pending;
    },
  };
}
```

`packages/extension/lib/config.ts`:
```ts
/**
 * Deployed Cloudflare Worker base URL (see packages/worker/README.md).
 * Use "http://localhost:8787" while running `pnpm -F @drexel-rmp/worker dev`.
 */
export const WORKER_URL = "https://drexel-rmp-worker.REPLACE-WITH-SUBDOMAIN.workers.dev";
export const WORKER_TIMEOUT_MS = 3000;
```
**Paste the real URL recorded in Task 6 step 5 into `WORKER_URL` now.**

- [ ] **Step 4: Wire the background service worker**

Replace `packages/extension/entrypoints/background.ts`:
```ts
import { lookupProfessorViaRmp, type LookupResult } from "@drexel-rmp/shared";
import { browser } from "wxt/browser";
import { getCached, setCached } from "@/lib/cache";
import { WORKER_TIMEOUT_MS, WORKER_URL } from "@/lib/config";
import { createLookupService } from "@/lib/lookup";

export default defineBackground(() => {
  const service = createLookupService({
    getCached,
    setCached,
    fetchFromWorker: async (name) => {
      const res = await fetch(`${WORKER_URL}/prof?name=${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`worker HTTP ${res.status}`);
      const json = (await res.json()) as LookupResult;
      if (json?.status !== "found" && json?.status !== "not_found") {
        throw new Error("unexpected worker response");
      }
      return json;
    },
    fetchDirect: (name) => lookupProfessorViaRmp(name),
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as { type?: string; name?: string };
    if (msg?.type === "LOOKUP_PROFESSOR" && typeof msg.name === "string") {
      service
        .lookup(msg.name)
        .then(sendResponse)
        .catch(() => sendResponse(null));
      return true; // keep the message channel open for the async response
    }
  });
});
```

- [ ] **Step 5: Run tests and build**

Run: `pnpm -F @drexel-rmp/extension test && pnpm -F @drexel-rmp/extension build`
Expected: all tests PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(extension): 3-layer lookup service wired into background worker"
```

---

### Task 11: Extension — badge + tooltip components

**Files:**
- Create: `packages/extension/components/badge.ts`, `packages/extension/components/tooltip.ts`
- Test: `packages/extension/components/badge.test.ts`

**Interfaces:**
- Consumes: `LookupResult`, `ProfessorRating` from shared; `DREXEL_LEGACY_SCHOOL_ID` for the not-found search link; `@floating-ui/dom`.
- Produces: `createBadge(result: LookupResult, queriedName: string): HTMLElement` — a `<span class="rmp-badge-host">` with a shadow root, ready to append next to an instructor name. All styling lives inside the shadow root.

- [ ] **Step 1: Write failing tests**

`packages/extension/components/badge.test.ts`:
```ts
import type { LookupResult } from "@drexel-rmp/shared";
import { describe, expect, it } from "vitest";
import { createBadge } from "./badge";

const rating = (r: number): LookupResult => ({
  status: "found",
  rating: {
    name: "Jeffrey Popyack", rating: r, difficulty: 3.6, wouldTakeAgain: 43,
    numRatings: 28, legacyId: 565937,
    rmpUrl: "https://www.ratemyprofessors.com/professor/565937",
  },
});

function badgeEl(result: LookupResult) {
  const host = createBadge(result, "Jeffrey Popyack");
  const badge = host.shadowRoot!.querySelector(".badge")!;
  return { host, badge };
}

describe("createBadge", () => {
  it("renders the rating in a shadow root with a link to the professor's RMP page", () => {
    const { host, badge } = badgeEl(rating(4.2));
    expect(host.shadowRoot).not.toBeNull();
    expect(badge.textContent).toContain("4.2");
    const link = host.shadowRoot!.querySelector("a")!;
    expect(link.href).toBe("https://www.ratemyprofessors.com/professor/565937");
    expect(link.target).toBe("_blank");
  });

  it.each([
    [4.2, "good"],
    [3.1, "ok"],
    [2.3, "bad"],
  ])("rating %f gets tier class %s", (r, tier) => {
    const { badge } = badgeEl(rating(r));
    expect(badge.classList.contains(tier)).toBe(true);
  });

  it("renders n/a linking to an RMP search for not_found", () => {
    const { host, badge } = badgeEl({ status: "not_found" });
    expect(badge.textContent).toContain("n/a");
    expect(badge.classList.contains("none")).toBe(true);
    const link = host.shadowRoot!.querySelector("a")!;
    expect(link.href).toContain("/search/professors/1521");
  });

  it("shows tooltip content on mouseenter and hides on mouseleave", () => {
    const { host } = badgeEl(rating(4.2));
    document.body.appendChild(host);
    const anchor = host.shadowRoot!.querySelector<HTMLElement>(".badge")!;
    anchor.dispatchEvent(new Event("mouseenter"));
    const tip = host.shadowRoot!.querySelector(".tooltip")!;
    expect(tip.textContent).toContain("Difficulty");
    expect(tip.textContent).toContain("3.6");
    expect(tip.textContent).toContain("43%");
    expect(tip.textContent).toContain("28");
    anchor.dispatchEvent(new Event("mouseleave"));
    expect(host.shadowRoot!.querySelector(".tooltip")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @drexel-rmp/extension test`
Expected: FAIL — `badge` module not found.

- [ ] **Step 3: Implement tooltip**

`packages/extension/components/tooltip.ts`:
```ts
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { ProfessorRating } from "@drexel-rmp/shared";

/** Create and position the hover card inside the badge's shadow root. */
export function showTooltip(shadow: ShadowRoot, anchor: HTMLElement, rating: ProfessorRating): void {
  hideTooltip(shadow);
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.innerHTML = `
    <div class="tip-name"></div>
    <div class="tip-row">Quality: <b>${rating.rating.toFixed(1)}</b> / 5</div>
    <div class="tip-row">Difficulty: <b>${rating.difficulty.toFixed(1)}</b> / 5</div>
    <div class="tip-row">Would take again: <b>${rating.wouldTakeAgain === null ? "—" : `${rating.wouldTakeAgain}%`}</b></div>
    <div class="tip-row">${rating.numRatings} rating${rating.numRatings === 1 ? "" : "s"}</div>
    <a class="tip-link" target="_blank" rel="noopener">View on Rate My Professors →</a>
  `;
  tip.querySelector<HTMLElement>(".tip-name")!.textContent = rating.name; // textContent: name is external data
  tip.querySelector<HTMLAnchorElement>(".tip-link")!.href = rating.rmpUrl;
  shadow.appendChild(tip);
  computePosition(anchor, tip, {
    placement: "top",
    middleware: [offset(6), flip(), shift({ padding: 4 })],
  }).then(({ x, y }) => {
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  });
}

export function hideTooltip(shadow: ShadowRoot): void {
  shadow.querySelector(".tooltip")?.remove();
}
```

- [ ] **Step 4: Implement badge**

`packages/extension/components/badge.ts`:
```ts
import { DREXEL_LEGACY_SCHOOL_ID, type LookupResult } from "@drexel-rmp/shared";
import { hideTooltip, showTooltip } from "./tooltip";

const STYLES = `
  :host { all: initial; }
  .badge {
    display: inline-block; margin-left: 6px; padding: 1px 6px;
    border-radius: 9px; font: 600 11px/1.5 system-ui, sans-serif;
    cursor: pointer; vertical-align: middle; white-space: nowrap;
  }
  .good { background: #dcf5dc; color: #146c2e; }
  .ok   { background: #fff3cd; color: #8a6d00; }
  .bad  { background: #fde2e1; color: #a12622; }
  .none { background: #ececec; color: #666; font-weight: 400; }
  a { text-decoration: none; color: inherit; }
  .tooltip {
    position: absolute; z-index: 2147483647; width: max-content; max-width: 260px;
    background: #1f1f1f; color: #f5f5f5; border-radius: 8px; padding: 10px 12px;
    font: 400 12px/1.6 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.25);
  }
  .tip-name { font-weight: 700; margin-bottom: 4px; }
  .tip-link { display: block; margin-top: 6px; color: #8ab4f8; }
`;

function tierClass(rating: number): string {
  if (rating >= 4) return "good";
  if (rating >= 3) return "ok";
  return "bad";
}

/** Badge host element (shadow DOM) to append after an instructor name. */
export function createBadge(result: LookupResult, queriedName: string): HTMLElement {
  const host = document.createElement("span");
  host.className = "rmp-badge-host";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.appendChild(style);

  const link = document.createElement("a");
  link.target = "_blank";
  link.rel = "noopener";
  const badge = document.createElement("span");

  if (result.status === "found") {
    const { rating } = result;
    badge.className = `badge ${tierClass(rating.rating)}`;
    badge.textContent = `★ ${rating.rating.toFixed(1)}`;
    link.href = rating.rmpUrl;
    badge.addEventListener("mouseenter", () => showTooltip(shadow, badge, rating));
    badge.addEventListener("mouseleave", () => hideTooltip(shadow));
  } else {
    badge.className = "badge none";
    badge.textContent = "n/a";
    badge.title = "No confident Rate My Professors match";
    const search = new URL(`https://www.ratemyprofessors.com/search/professors/${DREXEL_LEGACY_SCHOOL_ID}`);
    search.searchParams.set("q", queriedName);
    link.href = search.toString();
  }

  link.appendChild(badge);
  shadow.appendChild(link);
  return host;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @drexel-rmp/extension test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(extension): shadow-DOM rating badge with hover tooltip"
```

---

### Task 12: Extension — DOM fixtures (user-assisted) + scanner

**Files:**
- Create: `packages/extension/lib/scanner.ts`, `packages/extension/lib/sites.ts`
- Create: `packages/extension/lib/fixtures/tms.html`, `packages/extension/lib/fixtures/banner.html`
- Test: `packages/extension/lib/scanner.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (DOM-only module).
- Produces:
  - `interface SiteConfig { id: "tms" | "banner"; matches: string[]; instructorSelector: string; }`
  - `TMS_CONFIG: SiteConfig`, `BANNER_CONFIG: SiteConfig` in `lib/sites.ts`.
  - `startScanner(config: SiteConfig, onInstructor: (el: HTMLElement, rawText: string) => void): () => void` — fires once per unmarked element matching the selector (initial scan + MutationObserver rescans, 200 ms debounce), marks elements `data-rmp-processed`, returns a stop function.

- [ ] **Step 1: PAUSE — ask your human partner for real DOM captures**

The two Drexel sites are behind login, so real markup must come from the user. Ask them to do this for **both** sites and paste the results:

> 1. Log into the site (Term Master Schedule: termmasterschedule.drexel.edu; Banner: DrexelOne → Registration → Browse Classes/Registration, then run any search so results with instructor names are visible).
> 2. Copy the **full page URL** from the address bar.
> 3. Right-click an instructor's name → Inspect. In DevTools, find the smallest element that contains just the instructor name(s), then right-click its **parent row/table** element → Copy → Copy outerHTML.
> 4. Paste the URL + HTML here.

Save the captures (trimmed to a representative table/rows, personal data removed) as `packages/extension/lib/fixtures/tms.html` and `packages/extension/lib/fixtures/banner.html`. **Blocked until provided — do not fabricate fixtures.**

- [ ] **Step 2: Derive site configs from the fixtures**

Inspect the captured HTML and write `packages/extension/lib/sites.ts`. Structure (selectors below are the expected shape based on Banner 9's standard `data-property` markup and TMS's table layout — **verify each against the actual fixture and correct as needed**):
```ts
export interface SiteConfig {
  id: "tms" | "banner";
  /** Content-script match patterns (confirm against the URLs the user captured). */
  matches: string[];
  /** Selector for the element containing instructor name text. */
  instructorSelector: string;
}

export const TMS_CONFIG: SiteConfig = {
  id: "tms",
  matches: ["https://termmasterschedule.drexel.edu/*"],
  instructorSelector: "td.instructor", // VERIFY against fixtures/tms.html
};

export const BANNER_CONFIG: SiteConfig = {
  id: "banner",
  matches: ["https://*.drexel.edu/StudentRegistrationSsb/*"], // VERIFY against captured URL
  instructorSelector: 'td[data-property="instructor"]', // VERIFY against fixtures/banner.html
};
```
If the captured Banner URL is on a different host/path, update `matches` here — the host permission `https://*.drexel.edu/*` from Task 7 already covers any Drexel subdomain.

- [ ] **Step 3: Write failing tests against the fixtures**

`packages/extension/lib/scanner.test.ts` (adjust the two `expected` arrays to the instructor names actually present in the user's fixtures):
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startScanner } from "./scanner";
import { BANNER_CONFIG, TMS_CONFIG } from "./sites";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); document.body.innerHTML = ""; });

describe("startScanner", () => {
  it("finds instructor cells in the TMS fixture", () => {
    document.body.innerHTML = fixture("tms.html");
    const seen: string[] = [];
    stop = startScanner(TMS_CONFIG, (_el, text) => seen.push(text));
    expect(seen).toEqual(["Popyack, Jeffrey L"]); // ADJUST to fixture contents
  });

  it("finds instructor cells in the Banner fixture", () => {
    document.body.innerHTML = fixture("banner.html");
    const seen: string[] = [];
    stop = startScanner(BANNER_CONFIG, (_el, text) => seen.push(text));
    expect(seen.length).toBeGreaterThan(0); // ADJUST to exact fixture contents
  });

  it("never fires twice for the same element", async () => {
    document.body.innerHTML = fixture("tms.html");
    const seen: string[] = [];
    stop = startScanner(TMS_CONFIG, (_el, text) => seen.push(text));
    const count = seen.length;
    // Trigger a mutation; already-marked elements must be skipped.
    document.body.appendChild(document.createElement("div"));
    await new Promise((r) => setTimeout(r, 300)); // wait out the 200ms debounce
    expect(seen.length).toBe(count);
  });

  it("picks up dynamically added rows", async () => {
    document.body.innerHTML = "<table><tbody id='t'></tbody></table>";
    const seen: string[] = [];
    stop = startScanner(TMS_CONFIG, (_el, text) => seen.push(text));
    document.getElementById("t")!.innerHTML =
      `<tr><td class="instructor">Doe, Jane</td></tr>`; // use TMS_CONFIG's real selector
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual(["Doe, Jane"]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm -F @drexel-rmp/extension test`
Expected: FAIL — `scanner` module not found.

- [ ] **Step 5: Implement the scanner**

`packages/extension/lib/scanner.ts`:
```ts
import type { SiteConfig } from "./sites";

const PROCESSED_ATTR = "data-rmp-processed";
const DEBOUNCE_MS = 200;

/**
 * Scan now and on future DOM mutations for instructor elements.
 * Fires onInstructor exactly once per element; returns a stop function.
 */
export function startScanner(
  config: SiteConfig,
  onInstructor: (el: HTMLElement, rawText: string) => void,
): () => void {
  const scan = () => {
    for (const el of document.querySelectorAll<HTMLElement>(config.instructorSelector)) {
      if (el.hasAttribute(PROCESSED_ATTR)) continue;
      el.setAttribute(PROCESSED_ATTR, "1");
      const text = el.textContent?.trim();
      if (text) {
        try {
          onInstructor(el, text);
        } catch {
          // never let our errors escape into the host page
        }
      }
    }
  };

  scan();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm -F @drexel-rmp/extension test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(extension): mutation-observing instructor scanner with real DOM fixtures"
```

---

### Task 13: Extension — content scripts + manual E2E + README

**Files:**
- Create: `packages/extension/lib/inject.ts`, `packages/extension/entrypoints/tms.content.ts`, `packages/extension/entrypoints/banner.content.ts`
- Create: `docs/testing-checklist.md`, `README.md`

**Interfaces:**
- Consumes: `startScanner`/site configs (Task 12), `parseInstructorCell` (Task 8), `createBadge` (Task 11), background message protocol (Task 10).
- Produces: the working end-to-end extension.

- [ ] **Step 1: Implement the shared injection routine**

`packages/extension/lib/inject.ts`:
```ts
import type { LookupResult } from "@drexel-rmp/shared";
import { browser } from "wxt/browser";
import { createBadge } from "@/components/badge";
import { parseInstructorCell } from "@/lib/names";
import { startScanner } from "@/lib/scanner";
import type { SiteConfig } from "@/lib/sites";

/** Wire scanner -> name parsing -> background lookup -> badge injection for one site. */
export function runSite(config: SiteConfig): void {
  startScanner(config, (el, rawText) => {
    for (const name of parseInstructorCell(rawText)) {
      void lookupAndInject(el, name);
    }
  });
}

async function lookupAndInject(el: HTMLElement, name: string): Promise<void> {
  try {
    const result = (await browser.runtime.sendMessage({
      type: "LOOKUP_PROFESSOR",
      name,
    })) as LookupResult | null;
    if (result && el.isConnected) {
      el.appendChild(createBadge(result, name));
    }
  } catch {
    // background unreachable (e.g. extension reloading) — silently skip
  }
}
```

- [ ] **Step 2: Create both content scripts**

`packages/extension/entrypoints/tms.content.ts`:
```ts
import { runSite } from "@/lib/inject";
import { TMS_CONFIG } from "@/lib/sites";

export default defineContentScript({
  matches: TMS_CONFIG.matches,
  main() {
    runSite(TMS_CONFIG);
  },
});
```

`packages/extension/entrypoints/banner.content.ts`:
```ts
import { runSite } from "@/lib/inject";
import { BANNER_CONFIG } from "@/lib/sites";

export default defineContentScript({
  matches: BANNER_CONFIG.matches,
  main() {
    runSite(BANNER_CONFIG);
  },
});
```
(`defineContentScript` is a WXT auto-import.)

- [ ] **Step 3: Build and verify the manifest registers both content scripts**

Run: `pnpm -F @drexel-rmp/extension build && cat packages/extension/.output/chrome-mv3/manifest.json`
Expected: `content_scripts` array with two entries whose `matches` equal `TMS_CONFIG.matches` and `BANNER_CONFIG.matches`.

- [ ] **Step 4: Write the manual E2E checklist**

`docs/testing-checklist.md`:
```markdown
# Manual E2E checklist (run before each release)

Setup: `pnpm -F @drexel-rmp/extension build`, then chrome://extensions →
Developer mode → Load unpacked → `packages/extension/.output/chrome-mv3`.
(Or `pnpm -F @drexel-rmp/extension dev` for a live-reloading browser.)

- [ ] Term Master Schedule: search a large CS term listing → ★ badges appear next to instructors
- [ ] Banner (Browse Classes): search a subject → badges appear
- [ ] Badge color: green ≥ 4.0, yellow ≥ 3.0, red < 3.0, gray n/a for unmatched
- [ ] Spot-check 3 professors: badge rating matches their actual RMP page (click through)
- [ ] Tooltip on hover: quality, difficulty, would-take-again %, count, working RMP link
- [ ] n/a badge links to an RMP search for that name
- [ ] Multi-instructor section shows one badge per instructor
- [ ] STAFF/TBD sections show no badge
- [ ] Reload the page: badges reappear fast (local cache — check service worker
      console: no worker/RMP requests for repeated names)
- [ ] Kill switch drill: set WORKER_URL to a garbage domain, rebuild → badges still
      appear (direct RMP fallback). Restore WORKER_URL after.
- [ ] No layout breakage or console errors injected into either Drexel page
```

- [ ] **Step 5: Write the root README**

`README.md`:
```markdown
# drexel-rmp

Chrome extension showing Rate My Professors ratings inline on Drexel's
Term Master Schedule and Banner registration pages, backed by a
Cloudflare Worker KV cache with direct-to-RMP fallback.

## Layout

- `packages/extension` — WXT MV3 extension (content scripts, background lookup)
- `packages/worker` — Cloudflare Worker cache (`GET /prof?name=…`)
- `packages/shared` — types, RMP GraphQL client, name-match scoring

## Develop

    pnpm install
    pnpm test                          # all unit tests
    pnpm -F @drexel-rmp/extension dev  # launches Chrome with the extension loaded
    pnpm -F @drexel-rmp/worker dev     # worker on http://localhost:8787

## Release checks

See `docs/testing-checklist.md`. Worker deploy: `packages/worker/README.md`.
```

- [ ] **Step 6: Run the full test suite**

Run: `pnpm test`
Expected: all three packages' suites PASS.

- [ ] **Step 7: PAUSE — full manual E2E with your human partner**

Ask the user to run through `docs/testing-checklist.md` on the real logged-in sites (or drive it together via `pnpm -F @drexel-rmp/extension dev`). Fix any selector/matching issues found — selector fixes belong in `lib/sites.ts`, name-format fixes in `lib/names.ts` **with a new test case reproducing the real-world input first**.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(extension): content scripts wiring scanner to badges; E2E checklist"
```

---

## Deferred (explicitly out of scope, per spec)

- Extension popup / settings UI
- Firefox build (`wxt -b firefox` makes this cheap later)
- Chrome Web Store publishing (needs store assets, privacy blurb, $5 fee; codebase is already MV3-compliant)
- Automated authenticated E2E
- Tightening Worker CORS to the extension ID (after publishing, when the ID is stable)
