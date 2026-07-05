# Learning notes — Task 3: Match scoring (the hardest real problem in this project)

## The problem

Drexel's pages say `"Popyack, Jeffrey L"`. RMP says `Jeffrey Popyack`. Sometimes the page says `"Jeff Popyack"`, or `"Garcia-Lopez, Maria"` vs `Maria Garcia Lopez`. And sometimes two different professors are both plausible matches. We need a function that answers: *which RMP candidate, if any, is this person?* — with the spec's hard rule: **a wrong professor's rating is worse than no rating**. When unsure, return `null`.

## Levenshtein distance — fuzzy matching from first principles

`similarity(a, b)` is built on **Levenshtein distance**: the minimum number of single-character edits (insert, delete, substitute) to turn one string into another. `"smith"` → `"smythe"` is 2 edits. We convert distance to a 0–1 score:

```
similarity = 1 − distance / max(len(a), len(b))
```

The implementation is the classic **dynamic programming** algorithm — the same family as the edit-distance problems in every algorithms course (and coding interview). Ours keeps only the previous row (`prev`/`curr`), dropping memory from O(m×n) to O(n) — a standard DP space optimization worth being able to explain.

## Scoring design — encoding domain knowledge as weights

Raw string similarity isn't enough; names have *structure*. `nameScore` splits into first/last and weights them:

```
score = 0.6 × lastNameSim + 0.4 × firstNameSim
```

Why? Domain knowledge: last names are the stable identifier (first names get nicknamed — Jeff/Jeffrey, Bill/William — but nobody nicknames "Popyack"). Two more structural rules:

- **Prefix rule:** if one first name is a prefix of the other (min 3 chars), treat as a perfect first-name match. That's the nickname case. The 3-char minimum stops `"J"` from "matching" everything — which also means bare initials can never score high. Deliberate: an initial isn't enough evidence to pin a rating on someone.
- **Whole-name fallback:** also score the full names with spaces stripped, take the max. This rescues hyphen/spacing variants (`mary anne obrien` vs `Mary-Anne O'Brien` → identical once flattened) that token-splitting mis-segments.

Then two gates in `pickBestMatch`:
- **Threshold:** best score < 0.8 → `null`. Not confident enough.
- **Ambiguity guard:** if the runner-up *also* clears 0.8 and is within 0.05 of the best → `null`. Two plausible people = refuse to guess. (Real scenario: departments genuinely have two "John Smith"s.)

This is a pattern worth generalizing: **fuzzy scoring + confidence threshold + ambiguity rejection** is how you build any "match this messy string to that database" feature responsibly — the same skeleton as record linkage / entity resolution in data engineering.

## The review drama — and why it matters

This task produced the best lesson so far. The plan's test suite included:

```ts
it("rejects when two candidates are ambiguously close", () => {
  // "J Smith" vs John Smith / Jon Smith → expects null ✓ passes
});
```

The test passed. Ship it? **No.** The reviewer hand-traced the arithmetic: "J Smith" scores 0.70 and 0.75 against those candidates — *both below the 0.8 threshold*. The function returned `null` at the threshold gate; the ambiguity branch **never executed**. The test asserted the right answer for the wrong reason, and the ambiguity rule — an explicit spec requirement — had zero real coverage.

Lessons packed in here:

1. **A passing test only proves the output, not the path.** If a function has two ways to return `null`, a `null` assertion doesn't tell you which fired. When a *specific rule* matters, construct inputs where that rule is the only thing that can produce the expected output (our fix: two identical "John Smith" candidates — both score 1.0, so only the ambiguity gap can reject).
2. **Coverage-by-accident is invisible.** Line-coverage tools would have shown the branch untouched, but nobody looks when the suite is green. Adversarial review (hand-tracing the math) caught it.
3. **The fix was test-only.** `match.ts` was provably correct all along (the reviewer verified the branch by trace); what was broken was our *evidence*. We also renamed the old test to what it actually verifies — a test's name is documentation, and a mislabeled test is a lie waiting for the next reader.

## Where this plugs in next

`pickBestMatch` gets called from two places with the same inputs — the Cloudflare Worker and the extension's direct-fallback path (Task 4 builds the client they share). Same function, same thresholds ⇒ both paths always agree on who matched. That's the shared-package payoff again.
