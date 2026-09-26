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

describe("CORS allowlist", () => {
  const EXT = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  const ACAO = "Access-Control-Allow-Origin";

  // Cached entry so these tests never touch RMP.
  const seed = () => env.RMP_CACHE.put("prof:cached prof", JSON.stringify({ status: "not_found" }));
  const get = (headers: Record<string, string> = {}) =>
    new Request("https://worker.test/prof?name=cached%20prof", { headers });

  it("echoes the allowed extension origin", async () => {
    await seed();
    const res = await app.fetch(get({ Origin: EXT }), { ...env, ALLOWED_ORIGIN: EXT });
    expect(res.headers.get(ACAO)).toBe(EXT);
  });

  it("omits the header for a foreign origin but still serves the body", async () => {
    await seed();
    const res = await app.fetch(get({ Origin: "https://evil.example" }), { ...env, ALLOWED_ORIGIN: EXT });
    expect(res.headers.get(ACAO)).toBeNull();
    expect(await res.json()).toEqual({ status: "not_found" });
  });

  it("requests without an Origin (curl, extension service worker) are unchanged", async () => {
    await seed();
    const res = await app.fetch(get(), { ...env, ALLOWED_ORIGIN: EXT });
    expect(res.status).toBe(200);
    expect(res.headers.get(ACAO)).toBeNull();
  });

  it("empty ALLOWED_ORIGIN allows nothing, even a request with no Origin", async () => {
    await seed();
    for (const headers of [{}, { Origin: EXT }] as Record<string, string>[]) {
      const res = await app.fetch(get(headers), { ...env, ALLOWED_ORIGIN: "" });
      expect(res.headers.get(ACAO)).toBeNull();
    }
  });

  it("preflight: allowed origin gets 204 + header; foreign origin gets no header", async () => {
    const preflight = (origin: string) =>
      new Request("https://worker.test/prof?name=x", {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
      });
    const ok = await app.fetch(preflight(EXT), { ...env, ALLOWED_ORIGIN: EXT });
    expect(ok.status).toBe(204);
    expect(ok.headers.get(ACAO)).toBe(EXT);

    const foreign = await app.fetch(preflight("https://evil.example"), { ...env, ALLOWED_ORIGIN: EXT });
    expect(foreign.headers.get(ACAO)).toBeNull();
  });
});
