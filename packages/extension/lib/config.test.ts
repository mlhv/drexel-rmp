import { describe, expect, it } from "vitest";
import { resolveWorkerUrl } from "./config";
import { PROD_WORKER_URL } from "./manifest";

describe("resolveWorkerUrl", () => {
  it("defaults to the production Worker", () => {
    expect(resolveWorkerUrl(undefined)).toBe(PROD_WORKER_URL);
  });

  it("uses an override such as a local wrangler dev server", () => {
    expect(resolveWorkerUrl("http://localhost:8787")).toBe("http://localhost:8787");
  });

  it("treats an empty or blank override as unset", () => {
    expect(resolveWorkerUrl("")).toBe(PROD_WORKER_URL);
    expect(resolveWorkerUrl("   ")).toBe(PROD_WORKER_URL);
  });
});
