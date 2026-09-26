import { PROD_WORKER_URL } from "./manifest";

/** An override (e.g. a local `wrangler dev` server) wins; blank means unset. */
export function resolveWorkerUrl(override: string | undefined): string {
  return override?.trim() || PROD_WORKER_URL;
}

/**
 * Worker base URL. For a local Worker, put `WXT_WORKER_URL=http://localhost:8787`
 * in packages/extension/.env.development.local (untracked) and run the dev build.
 * Not `.env.local`: Vite loads that in every mode, so it would leak into store builds.
 */
export const WORKER_URL = resolveWorkerUrl(import.meta.env.WXT_WORKER_URL);
export const WORKER_TIMEOUT_MS = 3000;
/** Direct RMP is the last network layer; without a cap a hung request would block the lookup forever. */
export const DIRECT_TIMEOUT_MS = 5000;
