import type { UserManifest } from "wxt";

/** Deployed Cloudflare Worker base URL (see packages/worker/README.md). */
export const PROD_WORKER_URL = "https://drexel-rmp-worker.mlhv.workers.dev";

/**
 * The Chrome Web Store item's public key (Dashboard → Package → "View public key",
 * base64 body only). Dev builds embed it so unpacked installs share the store ID.
 * Empty until the runbook's bootstrap step (docs/store/runbook.md).
 */
export const EXTENSION_PUBLIC_KEY = "";

// No Drexel host: content scripts get page access from their own `matches`
// (lib/sites.ts), and only the background fetches, to RMP and the Worker.
const PROD_HOST_PERMISSIONS = [
  "https://www.ratemyprofessors.com/*",
  `${PROD_WORKER_URL}/*`,
];

/**
 * Manifest for a build mode. Only "development" gets localhost and `key`:
 * the Web Store rejects uploads containing `key`, and localhost is dev-only.
 */
export function buildManifest(mode: string, publicKey = EXTENSION_PUBLIC_KEY): UserManifest {
  const manifest: UserManifest = {
    name: "DU ProfessorView",
    description:
      "Professor ratings on Drexel's Term Master Schedule and Banner registration (unofficial).",
    permissions: ["storage"],
    host_permissions: [...PROD_HOST_PERMISSIONS],
  };
  if (mode !== "development") return manifest;

  manifest.host_permissions!.push("http://localhost:8787/*");
  const key = publicKey.trim();
  if (key) manifest.key = key;
  return manifest;
}
