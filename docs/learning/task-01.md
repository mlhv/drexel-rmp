# Learning notes — Task 1: Monorepo scaffold + shared package

## Where we are in the journey

Before any code, we produced two documents: a **spec** (what we're building and why — `docs/superpowers/specs/`) and a **plan** (13 bite-sized tasks with exact code — `docs/superpowers/plans/`). We also verified the RMP API assumptions *empirically* with `curl` before designing around them — a habit worth keeping: never build on an API assumption you haven't seen respond with your own eyes.

All implementation happens on a git branch (`feat/initial-implementation`), not `main`. `main` stays clean until the work is reviewed and merged — this is how professional teams work, and it means a broken experiment never contaminates the known-good history.

## What is a monorepo, and why pnpm workspaces?

We have three deployable things: a Chrome extension, a Cloudflare Worker, and code they both need. Options were three separate repos (painful: changing a shared type means three PRs) or one **monorepo** with three **packages**. The file that makes this work:

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

This tells pnpm: every folder under `packages/` is its own npm package. The magic is in dependency resolution — when `packages/worker/package.json` later says `"@drexel-rmp/shared": "workspace:*"`, pnpm doesn't download anything; it **symlinks** `node_modules/@drexel-rmp/shared` → `../../packages/shared`. Edit a shared type, and both consumers see it instantly. No publishing, no version juggling.

The `allowBuilds: esbuild` block is a pnpm security feature: packages can declare install-time scripts (esbuild compiles a native binary), and modern pnpm refuses to run them unless you allowlist them. We're saying "yes, we trust esbuild to build itself."

Useful commands you now have:
- `pnpm -r test` — run `test` in every package (`-r` = recursive)
- `pnpm -F @drexel-rmp/shared test` — run it in one package (`-F` = filter)

## The root package.json and tsconfig.base.json

The root `package.json` has `"private": true` (it's never published — it's just the workspace container) and delegating scripts. `tsconfig.base.json` holds compiler settings every package inherits via `"extends"` — single source of truth. The important ones:

- `"strict": true` — the whole family of TypeScript's null-checks and implicit-any bans. Non-negotiable on a new project; retrofitting strictness later is misery.
- `"noUncheckedIndexedAccess": true` — `arr[i]` has type `T | undefined`, forcing you to handle the out-of-bounds case. You'll see `!` (non-null assertions) in a few places where we *know* the index is valid.
- `"moduleResolution": "bundler"` — matches how our real consumers (Vite/WXT, wrangler's esbuild) resolve imports.

## The shared package — the "contract" of the system

Design idea: the extension and the Worker are separate programs on separate machines, but they must agree on the shape of the data flowing between them. If each defined its own `ProfessorRating`, they'd drift apart silently. So the shape lives in exactly one place and both import it. That's the whole reason `@drexel-rmp/shared` exists.

One subtle trick in `packages/shared/package.json`:

```json
"main": "src/index.ts",
"types": "src/index.ts"
```

Normally a package's `main` points at compiled `.js`. Ours points at raw TypeScript — legal here because every consumer (WXT, wrangler, vitest) compiles TS itself. This deletes an entire build step: no `dist/`, no "rebuild shared before testing worker" ceremony.

### types.ts — the three shapes

- `RmpTeacher` — exactly what RMP's API returns (their field names, their quirks like `wouldTakeAgainPercent: -1` meaning "unknown"). 
- `ProfessorRating` — the *cleaned* shape we show users (our names, `wouldTakeAgain: number | null` — we translate the `-1` quirk at the boundary so quirks don't leak through the codebase).
- `LookupResult` — the interesting one:

```ts
export type LookupResult =
  | { status: "found"; rating: ProfessorRating }
  | { status: "not_found" };
```

This is a **discriminated union** — TypeScript's flagship pattern. The `status` field discriminates which variant you hold, and the compiler enforces it: inside `if (result.status === "found")`, `result.rating` exists; outside, touching `.rating` is a compile error. Compare with a `rating?: ProfessorRating` optional field, where nothing stops you reading it when it's absent. We'll lean on this pattern constantly.

Also note `interface` vs `type`: we use `interface` for object shapes, `type` for unions. That's idiomatic TS.

### constants.ts — why constants get their own file

The RMP endpoint, the public auth header, the school IDs, and the GraphQL query string are facts, verified once against the live API. Centralizing them means: one place to update if RMP changes, and both the Worker and the extension are *provably* sending identical queries (they import the same string).

Fun detail: `DREXEL_SCHOOL_ID = "U2Nob29sLTE1MjE="` is base64 for `School-1521`. RMP's GraphQL layer (like many Relay-style APIs) encodes typed IDs this way; `1521` is Drexel's original numeric ID, still used in their page URLs — which is why we keep `DREXEL_LEGACY_SCHOOL_ID = 1521` too.

### The smoke test

```ts
expect(atob(DREXEL_SCHOOL_ID)).toBe("School-1521");
```

A **smoke test**: it doesn't test logic (there is none yet), it proves the toolchain works end-to-end (vitest finds the package, compiles TS, resolves imports) and locks the constants against accidental edits. `atob` decodes base64 — so this test actually *documents* the ID encoding for the next reader. Tests as documentation is a theme you'll see all through this project.

## The review process (meta-lesson)

A fresh subagent implemented this task, and a separate reviewer compared the git diff against the requirements. The reviewer caught a real bug: the `allowBuilds` fix existed in the working directory but **wasn't in the commit** — so a fresh clone of that commit could hang during `pnpm install`. Lesson: "works on my machine" and "works from a clean checkout of what I committed" are different claims; only the second one counts, and reviews verify the commit, not the directory.
