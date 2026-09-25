import { describe, expect, it } from "vitest";
import { normalizeInstructorName, parseInstructorCell } from "./names";

describe("normalizeInstructorName", () => {
  it.each([
    ["Smith, John", "John Smith"],
    ["Smith, John R", "John Smith"],       // middle initial dropped
    ["Smith, John R.", "John Smith"],
    ["Popyack, Jeffrey L", "Jeffrey Popyack"],
    ["John Smith", "John Smith"],          // already First Last
    ["John R. Smith", "John Smith"],
    ["Garcia-Lopez, Maria", "Maria Garcia-Lopez"],  // hyphens kept
    ["O'Brien, Mary", "Mary O'Brien"],     // apostrophes kept
    ["Smith, John, Jr.", "John Smith"],    // suffix dropped
    ["John Smith (Primary)", "John Smith"], // Banner's primary marker
    ["Van Der Berg, Hans", "Hans Van Der Berg"], // multi-word last name
    ["Dr. John Smith", "John Smith"],      // titles dropped
    ["Smith, Dr. John", "John Smith"],
    ["Prof John Smith", "John Smith"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeInstructorName(input)).toBe(expected);
  });

  it.each(["STAFF", "staff", "TBD", "TBA", "Instructor", "", "   ", ","])(
    "rejects non-name %j",
    (input) => expect(normalizeInstructorName(input)).toBeNull(),
  );
});

describe("parseInstructorCell", () => {
  it("splits multi-instructor cells on semicolons", () => {
    expect(parseInstructorCell("Smith, John; Doe, Jane")).toEqual(["John Smith", "Jane Doe"]);
  });
  it("drops STAFF entries but keeps real ones", () => {
    expect(parseInstructorCell("STAFF; Doe, Jane")).toEqual(["Jane Doe"]);
  });
  it("dedupes repeated names", () => {
    expect(parseInstructorCell("Smith, John; Smith, John R")).toEqual(["John Smith"]);
  });
  it("returns [] for empty/junk cells", () => {
    expect(parseInstructorCell("  ")).toEqual([]);
  });
  it("splits on a site-specific separator (TMS joins First-Last names with commas)", () => {
    // Real TMS cell, captured 2026-09-24
    expect(parseInstructorCell("Tammy R Pirmann, Matthew J Burlick", /,/)).toEqual([
      "Tammy Pirmann",
      "Matthew Burlick",
    ]);
  });
});
