import type { RmpTeacher } from "./types";

/** Defensively extract valid teacher nodes from an RMP GraphQL response. Never throws. */
export function parseTeacherSearchResponse(json: unknown): RmpTeacher[] {
  const edges = (json as any)?.data?.newSearch?.teachers?.edges;
  if (!Array.isArray(edges)) return [];
  const teachers: RmpTeacher[] = [];
  for (const edge of edges) {
    const n = edge?.node;
    if (
      typeof n?.id === "string" &&
      typeof n?.legacyId === "number" &&
      typeof n?.firstName === "string" &&
      typeof n?.lastName === "string" &&
      typeof n?.avgRating === "number" &&
      typeof n?.avgDifficulty === "number" &&
      typeof n?.numRatings === "number" &&
      typeof n?.wouldTakeAgainPercent === "number"
    ) {
      teachers.push({
        id: n.id,
        legacyId: n.legacyId,
        firstName: n.firstName,
        lastName: n.lastName,
        avgRating: n.avgRating,
        avgDifficulty: n.avgDifficulty,
        numRatings: n.numRatings,
        wouldTakeAgainPercent: n.wouldTakeAgainPercent,
        department: typeof n.department === "string" ? n.department : undefined,
      });
    }
  }
  return teachers;
}
