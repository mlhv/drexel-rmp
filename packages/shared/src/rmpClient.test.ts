import { describe, expect, it, vi } from "vitest";
import { lookupProfessorViaRmp, searchRmpTeachers, teacherToRating } from "./rmpClient";
import { DREXEL_SCHOOL_ID, RMP_AUTH_HEADER, RMP_GRAPHQL_URL } from "./constants";
import fixture from "./fixtures/teacherSearchResponse.json";

const okFetch = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("searchRmpTeachers", () => {
  it("POSTs the query with auth header and school scope", async () => {
    const fetchFn = okFetch(fixture);
    const teachers = await searchRmpTeachers("Jeffrey Popyack", fetchFn);
    expect(teachers).toHaveLength(1);
    const [url, init] = (fetchFn as any).mock.calls[0];
    expect(url).toBe(RMP_GRAPHQL_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(RMP_AUTH_HEADER);
    const body = JSON.parse(init.body);
    expect(body.variables.query).toEqual({ text: "Jeffrey Popyack", schoolID: DREXEL_SCHOOL_ID });
  });

  it("throws on non-200", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(searchRmpTeachers("X", fetchFn)).rejects.toThrow(/503/);
  });
});

describe("lookupProfessorViaRmp", () => {
  it("returns found with mapped rating for a confident match", async () => {
    const result = await lookupProfessorViaRmp("Jeffrey Popyack", okFetch(fixture));
    expect(result).toEqual({
      status: "found",
      rating: {
        name: "Jeffrey Popyack",
        rating: 2.3,
        difficulty: 3.6,
        wouldTakeAgain: 43,
        numRatings: 28,
        legacyId: 565937,
        rmpUrl: "https://www.ratemyprofessors.com/professor/565937",
      },
    });
  });

  it("returns not_found when no candidate matches", async () => {
    const result = await lookupProfessorViaRmp("Zzyzx Nobody", okFetch(fixture));
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns not_found for a match with zero ratings", async () => {
    const zero = JSON.parse(JSON.stringify(fixture));
    zero.data.newSearch.teachers.edges[0].node.numRatings = 0;
    const result = await lookupProfessorViaRmp("Jeffrey Popyack", okFetch(zero));
    expect(result).toEqual({ status: "not_found" });
  });
});

describe("teacherToRating", () => {
  it("maps wouldTakeAgainPercent -1 to null", () => {
    const t = { ...((fixture as any).data.newSearch.teachers.edges[0].node), wouldTakeAgainPercent: -1 };
    expect(teacherToRating(t).wouldTakeAgain).toBeNull();
  });
});
