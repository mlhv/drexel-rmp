# drexel-rmp

**DU ProfessorView** — Chrome extension showing Rate My Professors ratings inline on
Drexel's Term Master Schedule and Banner registration pages, backed by a Cloudflare
Worker KV cache with direct-to-RMP fallback.

Not affiliated with or endorsed by Drexel University or Rate My Professors.

## Layout

- `packages/extension` — WXT MV3 extension (content scripts, background lookup)
- `packages/worker` — Cloudflare Worker cache (`GET /prof?name=…`), live at
  https://drexel-rmp-worker.mlhv.workers.dev
- `packages/shared` — types, RMP GraphQL client, name-match scoring

## Develop

    pnpm install
    pnpm test                          # all unit tests
    pnpm -F @drexel-rmp/extension dev  # launches Chrome with the extension loaded
    pnpm -F @drexel-rmp/worker dev     # worker on http://localhost:8787

To point a dev build at the local Worker, create `packages/extension/.env.local`
containing `WXT_WORKER_URL=http://localhost:8787`.

To use the extension day to day: `pnpm -F @drexel-rmp/extension build`, then
chrome://extensions → Developer mode → Load unpacked →
`packages/extension/.output/chrome-mv3`.

## Release checks

See `docs/testing-checklist.md`. Worker deploy: `packages/worker/README.md`.
Learning notes for each build step: `docs/learning/`.
Chrome Web Store submission: `docs/store/runbook.md` (listing copy in `docs/store/listing.md`).
