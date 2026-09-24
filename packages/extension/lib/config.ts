/**
 * Deployed Cloudflare Worker base URL (see packages/worker/README.md).
 * Use "http://localhost:8787" while running `pnpm -F @drexel-rmp/worker dev`.
 */
export const WORKER_URL = "https://drexel-rmp-worker.mlhv.workers.dev";
export const WORKER_TIMEOUT_MS = 3000;
/** Direct RMP is the last network layer; without a cap a hung request would block the lookup forever. */
export const DIRECT_TIMEOUT_MS = 5000;
