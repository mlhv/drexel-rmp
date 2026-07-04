export const RMP_GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql";
/** Public credential shipped by RMP's own frontend (base64 of "test:test"). Not a secret. */
export const RMP_AUTH_HEADER = "Basic dGVzdDp0ZXN0";
/** GraphQL node ID for Drexel University (School-1521). Verified live 2026-07-04. */
export const DREXEL_SCHOOL_ID = "U2Nob29sLTE1MjE=";
/** Legacy numeric ID, used in ratemyprofessors.com URLs. */
export const DREXEL_LEGACY_SCHOOL_ID = 1521;

export const TEACHER_SEARCH_QUERY = `
query TeacherSearch($query: TeacherSearchQuery!) {
  newSearch {
    teachers(query: $query) {
      edges {
        node {
          id
          legacyId
          firstName
          lastName
          avgRating
          avgDifficulty
          numRatings
          wouldTakeAgainPercent
          department
        }
      }
    }
  }
}`;
