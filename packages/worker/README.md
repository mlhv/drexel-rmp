# drexel-rmp-worker

Cache proxy for RMP lookups. Deployed at:

    https://drexel-rmp-worker.mlhv.workers.dev

- `GET /prof?name=<first last>` → `LookupResult` JSON (see @drexel-rmp/shared)
- KV: `RMP_CACHE` (id `2e1d7c3f7219480fadaa9a4d2cb31e92`), keys `prof:<lowercased name>`, TTL 7d found / 1d not_found
- Deploy: `pnpm -F @drexel-rmp/worker deploy` (requires `wrangler login`)
