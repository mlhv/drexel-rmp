import { DREXEL_SCHOOL_ID, RMP_AUTH_HEADER, RMP_GRAPHQL_URL, TEACHER_SEARCH_QUERY } from "./constants";
import { pickBestMatch } from "./match";
import { parseTeacherSearchResponse } from "./rmpParse";
import type { LookupResult, ProfessorRating, RmpTeacher } from "./types";

export async function searchRmpTeachers(name: string, fetchFn: typeof fetch = fetch): Promise<RmpTeacher[]> {
  const res = await fetchFn(RMP_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: RMP_AUTH_HEADER,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: TEACHER_SEARCH_QUERY,
      variables: { query: { text: name, schoolID: DREXEL_SCHOOL_ID } },
    }),
  });
  if (!res.ok) throw new Error(`RMP GraphQL HTTP ${res.status}`);
  return parseTeacherSearchResponse(await res.json());
}

export function teacherToRating(t: RmpTeacher): ProfessorRating {
  return {
    name: `${t.firstName} ${t.lastName}`,
    rating: t.avgRating,
    difficulty: t.avgDifficulty,
    wouldTakeAgain: t.wouldTakeAgainPercent >= 0 ? Math.round(t.wouldTakeAgainPercent) : null,
    numRatings: t.numRatings,
    legacyId: t.legacyId,
    rmpUrl: `https://www.ratemyprofessors.com/professor/${t.legacyId}`,
  };
}

/** Search + match + map. Throws on network/HTTP failure so callers can fall back. */
export async function lookupProfessorViaRmp(name: string, fetchFn: typeof fetch = fetch): Promise<LookupResult> {
  const teachers = await searchRmpTeachers(name, fetchFn);
  const best = pickBestMatch(name, teachers);
  if (!best || best.numRatings === 0) return { status: "not_found" };
  return { status: "found", rating: teacherToRating(best) };
}
