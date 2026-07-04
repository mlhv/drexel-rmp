/** Raw teacher node from RMP's GraphQL teacher search. */
export interface RmpTeacher {
  id: string;
  legacyId: number;
  firstName: string;
  lastName: string;
  avgRating: number;
  avgDifficulty: number;
  numRatings: number;
  /** RMP uses -1 when unknown. */
  wouldTakeAgainPercent: number;
  department?: string;
}

/** Cleaned rating shape shown to users. The wire format between worker and extension. */
export interface ProfessorRating {
  /** RMP's canonical name, e.g. "Jeffrey Popyack". */
  name: string;
  rating: number;
  difficulty: number;
  /** Percent 0-100, or null when RMP has no data. */
  wouldTakeAgain: number | null;
  numRatings: number;
  legacyId: number;
  rmpUrl: string;
}

export type LookupResult =
  | { status: "found"; rating: ProfessorRating }
  | { status: "not_found" };
