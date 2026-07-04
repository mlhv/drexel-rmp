import { describe, expect, it } from "vitest";
import { DREXEL_SCHOOL_ID, RMP_AUTH_HEADER, RMP_GRAPHQL_URL } from "./constants";

describe("constants", () => {
  it("exports the verified RMP constants", () => {
    expect(RMP_GRAPHQL_URL).toBe("https://www.ratemyprofessors.com/graphql");
    expect(atob(DREXEL_SCHOOL_ID)).toBe("School-1521");
    expect(atob(RMP_AUTH_HEADER.replace("Basic ", ""))).toBe("test:test");
  });
});
