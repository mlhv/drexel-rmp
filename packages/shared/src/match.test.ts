import { describe, expect, it } from "vitest";
import { pickBestMatch, similarity } from "./match";
import type { RmpTeacher } from "./types";

function teacher(firstName: string, lastName: string, over: Partial<RmpTeacher> = {}): RmpTeacher {
  return {
    id: "x", legacyId: 1, firstName, lastName,
    avgRating: 4, avgDifficulty: 3, numRatings: 10, wouldTakeAgainPercent: 80,
    ...over,
  };
}

describe("similarity", () => {
  it("is 1 for identical strings and 0 for disjoint ones", () => {
    expect(similarity("smith", "smith")).toBe(1);
    expect(similarity("smith", "xyzqw")).toBeLessThan(0.3);
  });
});

describe("pickBestMatch", () => {
  it("matches an exact name", () => {
    const t = teacher("Jeffrey", "Popyack");
    expect(pickBestMatch("Jeffrey Popyack", [t])).toBe(t);
  });

  it("matches nickname/prefix first names (Jeff ~ Jeffrey)", () => {
    const t = teacher("Jeffrey", "Popyack");
    expect(pickBestMatch("Jeff Popyack", [t])).toBe(t);
  });

  it("is case-insensitive and punctuation-insensitive", () => {
    const t = teacher("Mary-Anne", "O'Brien");
    expect(pickBestMatch("mary anne obrien", [t])).toBe(t);
  });

  it("rejects a different professor even with same first name", () => {
    expect(pickBestMatch("John Smith", [teacher("John", "Smythe-Kowalski")])).toBeNull();
  });

  it("rejects when no candidate clears the confidence threshold", () => {
    const a = teacher("John", "Smith");
    const b = teacher("Jon", "Smith");
    expect(pickBestMatch("J Smith", [a, b])).toBeNull();
  });

  it("rejects when two candidates both clear the threshold and are too close", () => {
    const a = teacher("John", "Smith");
    const b = teacher("John", "Smith"); // same-named professors exist in real departments
    expect(pickBestMatch("John Smith", [a, b])).toBeNull();
  });

  it("picks the clearly better of two candidates", () => {
    const right = teacher("John", "Smith");
    const wrong = teacher("Jane", "Smithers");
    expect(pickBestMatch("John Smith", [wrong, right])).toBe(right);
  });

  it("returns null for empty candidate list", () => {
    expect(pickBestMatch("John Smith", [])).toBeNull();
  });
});
