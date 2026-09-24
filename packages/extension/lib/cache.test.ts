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
  vi.restoreAllMocks();
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

  it("treats a malformed stored entry as a miss", async () => {
    await fakeBrowser.storage.local.set({ "rmp:jeffrey popyack": { junk: true } });
    expect(await getCached("Jeffrey Popyack")).toBeNull();
  });

  it("treats a storage read failure as a miss instead of throwing", async () => {
    vi.spyOn(fakeBrowser.storage.local, "get").mockRejectedValue(new Error("storage broken"));
    expect(await getCached("Jeffrey Popyack")).toBeNull();
  });

  it("swallows storage write failures", async () => {
    vi.spyOn(fakeBrowser.storage.local, "set").mockRejectedValue(new Error("quota exceeded"));
    await expect(setCached("Jeffrey Popyack", FOUND)).resolves.toBeUndefined();
  });
});
