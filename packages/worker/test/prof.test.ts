import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";
import fixture from "../../shared/src/fixtures/teacherSearchResponse.json";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

function mockRmp(body: unknown, status = 200) {
  fetchMock
    .get("https://www.ratemyprofessors.com")
    .intercept({ method: "POST", path: "/graphql" })
    .reply(status, JSON.stringify(body));
}

const req = (name?: string) =>
  new Request(`https://worker.test/prof${name ? `?name=${encodeURIComponent(name)}` : ""}`);

describe("GET /prof", () => {
  it("400s without a name", async () => {
    const res = await app.fetch(req(), env);
    expect(res.status).toBe(400);
  });

  it("cache miss: queries RMP, returns found, and stores in KV", async () => {
    mockRmp(fixture);
    const res = await app.fetch(req("Jeffrey Popyack"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("found");
    expect(body.rating.legacyId).toBe(565937);
    const stored = await env.RMP_CACHE.get("prof:jeffrey popyack", "json");
    expect((stored as any).status).toBe("found");
  });

  it("cache hit: serves from KV without calling RMP", async () => {
    await env.RMP_CACHE.put("prof:cached prof", JSON.stringify({ status: "not_found" }));
    const res = await app.fetch(req("Cached Prof"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "not_found" });
    // no interceptor registered — disableNetConnect() makes any RMP call throw, which would 502 this request
  });

  it("502s when RMP is down on a cache miss", async () => {
    mockRmp({ error: "down" }, 503);
    const res = await app.fetch(req("Someone New"), env);
    expect(res.status).toBe(502);
  });

  it("serves the lookup even when KV is completely broken", async () => {
    mockRmp(fixture);
    const brokenKv = {
      get: async () => { throw new Error("kv down"); },
      put: async () => { throw new Error("kv down"); },
    } as unknown as KVNamespace;
    const res = await app.fetch(req("Jeffrey Popyack"), { RMP_CACHE: brokenKv });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).status).toBe("found");
  });
});
