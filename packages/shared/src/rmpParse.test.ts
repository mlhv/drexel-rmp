import { describe, expect, it } from "vitest";
import { parseTeacherSearchResponse } from "./rmpParse";
import fixture from "./fixtures/teacherSearchResponse.json";

describe("parseTeacherSearchResponse", () => {
  it("parses a real RMP response", () => {
    const teachers = parseTeacherSearchResponse(fixture);
    expect(teachers).toHaveLength(1);
    expect(teachers[0]).toMatchObject({
      firstName: "Jeffrey",
      lastName: "Popyack",
      legacyId: 565937,
      avgRating: 2.3,
      numRatings: 28,
    });
  });

  it("returns [] for malformed payloads instead of throwing", () => {
    for (const bad of [null, undefined, 42, "x", {}, { data: {} }, { data: { newSearch: { teachers: { edges: "nope" } } } }]) {
      expect(parseTeacherSearchResponse(bad)).toEqual([]);
    }
  });

  it("drops nodes missing required fields but keeps valid ones", () => {
    const mixed = {
      data: { newSearch: { teachers: { edges: [
        { node: { firstName: "Jane" } },
        (fixture as any).data.newSearch.teachers.edges[0],
      ] } } },
    };
    expect(parseTeacherSearchResponse(mixed)).toHaveLength(1);
  });
});
