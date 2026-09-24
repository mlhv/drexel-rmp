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

  it("refreshes a stale cache entry from the network", async () => {
    const deps = makeDeps({
      getCached: vi.fn(async () => ({ result: NOT_FOUND, fresh: false })),
    });
    expect(await createLookupService(deps).lookup("A B")).toEqual(FOUND);
    expect(deps.setCached).toHaveBeenCalledWith("A B", FOUND);
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
    await vi.waitFor(() => expect(deps.fetchFromWorker).toHaveBeenCalled());
    resolveWorker(FOUND);
    expect(await p1).toEqual(FOUND);
    expect(await p2).toEqual(FOUND);
    expect(deps.fetchFromWorker).toHaveBeenCalledTimes(1);
  });

  it("starts a new lookup once the previous one for that name settles", async () => {
    const deps = makeDeps();
    const svc = createLookupService(deps);
    await svc.lookup("A B");
    await svc.lookup("A B");
    expect(deps.fetchFromWorker).toHaveBeenCalledTimes(2);
  });
});
