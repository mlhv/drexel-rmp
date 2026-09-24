import type { LookupResult } from "@drexel-rmp/shared";
import { describe, expect, it, vi } from "vitest";
import { createWorkerFetcher, withTimeout } from "./workerClient";

const FOUND: LookupResult = {
  status: "found",
  rating: {
    name: "Jeffrey Popyack", rating: 2.3, difficulty: 3.6, wouldTakeAgain: 43,
    numRatings: 28, legacyId: 565937,
    rmpUrl: "https://www.ratemyprofessors.com/professor/565937",
  },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("createWorkerFetcher", () => {
  it("requests /prof with the name URL-encoded and returns a found result", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(FOUND));
    const fetcher = createWorkerFetcher("https://w.example", 3000, fetchFn);
    expect(await fetcher("Mary O'Brien-Smith")).toEqual(FOUND);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://w.example/prof?name=Mary%20O'Brien-Smith",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns not_found results", async () => {
    const fetcher = createWorkerFetcher("https://w.example", 3000, async () => jsonResponse({ status: "not_found" }));
    expect(await fetcher("A B")).toEqual({ status: "not_found" });
  });

  it("throws on a non-2xx response", async () => {
    const fetcher = createWorkerFetcher("https://w.example", 3000, async () => jsonResponse({ error: "rmp_unavailable" }, 502));
    await expect(fetcher("A B")).rejects.toThrow("worker HTTP 502");
  });

  it.each([
    ["unknown status", { status: "weird" }],
    ["found without a rating", { status: "found" }],
    ["rating missing numeric fields", { status: "found", rating: { name: "A B", rmpUrl: "x" } }],
    ["not an object", "hello"],
  ])("throws on a malformed body (%s)", async (_label, body) => {
    const fetcher = createWorkerFetcher("https://w.example", 3000, async () => jsonResponse(body));
    await expect(fetcher("A B")).rejects.toThrow("unexpected worker response");
  });

  it("aborts when the worker is slower than the timeout", async () => {
    const hang = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
      });
    const fetcher = createWorkerFetcher("https://w.example", 20, hang);
    await expect(fetcher("A B")).rejects.toThrow("aborted");
  });
});

describe("withTimeout", () => {
  it("adds an abort signal while keeping the caller's request options", async () => {
    const fetchFn = vi.fn(async () => new Response("ok"));
    await withTimeout(fetchFn, 1000)("https://x.example", { method: "POST", body: "b" });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://x.example",
      expect.objectContaining({ method: "POST", body: "b", signal: expect.any(AbortSignal) }),
    );
  });
});
