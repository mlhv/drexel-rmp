import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest";

// No Drexel host: content scripts get page access from their own `matches`,
// and only the background fetches (RMP + Worker).
const PROD_HOSTS = [
  "https://www.ratemyprofessors.com/*",
  "https://drexel-rmp-worker.mlhv.workers.dev/*",
];

describe("buildManifest", () => {
  it("production: exact store permissions, no key, no localhost", () => {
    // Guard test: a permission change must be a deliberate edit here — reviewers
    // compare the store listing's justifications against this list.
    expect(buildManifest("production", "SOME_KEY")).toEqual({
      name: "DU ProfessorView",
      description:
        "Professor ratings on Drexel's Term Master Schedule and Banner registration (unofficial).",
      permissions: ["storage"],
      host_permissions: PROD_HOSTS,
    });
  });

  it("development: adds localhost and the key", () => {
    const m = buildManifest("development", "SOME_KEY");
    expect(m.host_permissions).toEqual([...PROD_HOSTS, "http://localhost:8787/*"]);
    expect(m.key).toBe("SOME_KEY");
  });

  it("development before bootstrap: empty or blank key is omitted, not emitted as \"\"", () => {
    expect(buildManifest("development", "")).not.toHaveProperty("key");
    expect(buildManifest("development", "  \n")).not.toHaveProperty("key");
  });

  it("any non-development mode is treated as production", () => {
    expect(buildManifest("staging", "SOME_KEY")).toEqual(buildManifest("production", "SOME_KEY"));
  });
});
