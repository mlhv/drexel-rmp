const NON_NAMES = new Set(["staff", "tba", "tbd", "instructor", "unassigned"]);
const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);
const TITLES = new Set(["dr", "prof", "professor", "mr", "mrs", "ms"]);

const isInitial = (token: string) => /^[a-z]\.?$/i.test(token);
const isSuffix = (token: string) => SUFFIXES.has(token.toLowerCase());
const isTitle = (token: string) => TITLES.has(token.toLowerCase().replace(/\.$/, ""));

function cleanTokens(part: string): string[] {
  return part
    .split(/\s+/)
    .filter((t) => t.length > 0 && !isInitial(t) && !isSuffix(t) && !isTitle(t));
}

/** "Smith, John R" | "John R. Smith" -> "John Smith"; null for STAFF/TBD/unparseable. */
export function normalizeInstructorName(raw: string): string | null {
  const text = raw.replace(/\(.*?\)/g, "").trim(); // strip "(Primary)" etc.
  if (!text || NON_NAMES.has(text.toLowerCase())) return null;

  let firstPart: string;
  let lastPart: string;
  if (text.includes(",")) {
    // "Last, First [M] [, Suffix]"
    const segments = text.split(",").map((s) => s.trim()).filter(Boolean);
    if (segments.length < 2) return null;
    lastPart = segments[0]!;
    firstPart = segments[1]!; // segment 3+ is a suffix like "Jr." — dropped
  } else {
    // "First [M] Last..." — first token is the first name, rest is the last name
    const tokens = cleanTokens(text);
    if (tokens.length < 2) return null;
    firstPart = tokens[0]!;
    lastPart = tokens.slice(1).join(" ");
  }

  const first = cleanTokens(firstPart)[0];
  const last = cleanTokens(lastPart).join(" ");
  if (!first || !last) return null;
  return `${first} ${last}`;
}

/**
 * Split a multi-instructor cell on `separator` (e.g. "A; B"), normalize each, drop non-names, dedupe.
 * Split happens before normalizing, so a comma separator means each piece is read as "First Last".
 */
export function parseInstructorCell(text: string, separator: string | RegExp = ";"): string[] {
  const names = text
    .split(separator)
    .map(normalizeInstructorName)
    .filter((n): n is string => n !== null);
  return [...new Set(names)];
}
