import type { RmpTeacher } from "./types";

const ACCEPT_THRESHOLD = 0.8;
const AMBIGUITY_GAP = 0.05;

function clean(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n]!;
}

/** 0–1 string similarity based on Levenshtein distance. */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const max = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / max;
}

function isPrefixMatch(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

function nameScore(query: string, candidate: string): number {
  const qTokens = query.split(" ");
  const cTokens = candidate.split(" ");
  const qFirst = qTokens[0] ?? "";
  const cFirst = cTokens[0] ?? "";
  const qLast = qTokens.slice(1).join(" ") || qFirst;
  const cLast = cTokens.slice(1).join(" ") || cFirst;
  // Also compare with candidate last-name spaces removed ("mary anne obrien" vs "o brien").
  const lastSim = Math.max(
    similarity(qLast, cLast),
    similarity(qLast.replace(/\s/g, ""), cLast.replace(/\s/g, "")),
  );
  const firstSim = isPrefixMatch(qFirst, cFirst) ? 1 : similarity(qFirst, cFirst);
  const tokenScore = 0.6 * lastSim + 0.4 * firstSim;
  // Whole-name fallback (spaces removed) rescues hyphen/spacing variants like
  // "mary anne obrien" vs "Mary-Anne O'Brien" that token splitting mis-segments.
  const wholeScore = similarity(query.replace(/\s/g, ""), candidate.replace(/\s/g, ""));
  return Math.max(tokenScore, wholeScore);
}

/**
 * Pick the candidate matching a normalized "First Last" query.
 * Returns null rather than guess: below-threshold or ambiguous → no match.
 */
export function pickBestMatch(query: string, candidates: RmpTeacher[]): RmpTeacher | null {
  const q = clean(query);
  if (!q) return null;
  const scored = candidates
    .map((c) => ({ c, score: nameScore(q, clean(`${c.firstName} ${c.lastName}`)) }))
    .sort((x, y) => y.score - x.score);
  const best = scored[0];
  if (!best || best.score < ACCEPT_THRESHOLD) return null;
  const second = scored[1];
  if (second && second.score >= ACCEPT_THRESHOLD && best.score - second.score < AMBIGUITY_GAP) {
    return null; // two plausible matches — refuse to guess
  }
  return best.c;
}
